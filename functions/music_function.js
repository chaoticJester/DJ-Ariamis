const { EmbedBuilder } = require('discord.js');

// ==========================================
// Helper: Format milliseconds to mm:ss or hh:mm:ss
// ==========================================
function formatDuration(ms) {
    if (!ms || ms <= 0) return 'Live 🔴';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Helper: Detect source platform from URI
function getSourceLabel(uri = '') {
    if (uri.includes('youtube.com') || uri.includes('youtu.be')) return '🎬 YouTube';
    if (uri.includes('music.youtube.com')) return '🎵 YouTube Music';
    if (uri.includes('soundcloud.com')) return '☁️ SoundCloud';
    if (uri.includes('spotify.com')) return '🟢 Spotify';
    if (uri.includes('twitch.tv')) return '🟣 Twitch';
    return '🎵 Unknown';
}

// Helper: Get loop mode label
function getLoopLabel(mode) {
    if (mode === 'SONG') return '🔂 วนซ้ำเพลงเดียว';
    if (mode === 'QUEUE') return '🔁 วนซ้ำทั้งคิว';
    return '➡️ ปิด';
}

// ==========================================
// Helper: Clear leave timer
// ==========================================
function clearLeaveTimer(guildId, leaveTimeouts) {
    if (leaveTimeouts.has(guildId)) {
        clearTimeout(leaveTimeouts.get(guildId));
        leaveTimeouts.delete(guildId);
    }
}

// Helper: Start 5-minute leave timer
function startLeaveTimer(guildId, shoukaku, queues, leaveTimeouts, channel) {
    clearLeaveTimer(guildId, leaveTimeouts);

    const timeout = setTimeout(async () => {
        const player = shoukaku.players.get(guildId);
        if (player) {
            await shoukaku.leaveVoiceChannel(guildId);
            queues.delete(guildId);
            leaveTimeouts.delete(guildId);

            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('⏳ ออกจากห้องเสียงแล้ว')
                .setDescription('ไม่มีเพลงเล่นเกิน **5 นาที** ผมขอตัวออกก่อนนะครับ บาย~ 👋')
                .setTimestamp();

            channel.send({ embeds: [embed] });
            console.log(`[Auto-Leave] ออกจากห้อง ${guildId} เพราะไม่มีเพลงเล่น`);
        }
    }, 5 * 60 * 1000);

    leaveTimeouts.set(guildId, timeout);
}

// ==========================================
// Helper: Extract full track info from Lavalink result
// ==========================================
function extractTrackInfo(result) {
    let trackData;
    if (result.loadType === 'playlist') {
        trackData = result.data.tracks[0];
    } else if (result.loadType === 'search') {
        trackData = result.data[0];
    } else if (result.loadType === 'track') {
        trackData = result.data;
    }

    const info = trackData?.info || {};
    return {
        encoded: trackData?.encoded,
        title: info.title || 'ไม่ทราบชื่อเพลง',
        author: info.author || 'ไม่ทราบศิลปิน',
        duration: info.length || 0,
        uri: info.uri || '',
        artworkUrl: info.artworkUrl || null,
        isStream: info.isStream || false,
        sourceName: info.sourceName || '',
    };
}

// ==========================================
// Build "Now Playing" embed
// ==========================================
function buildNowPlayingEmbed(track, queueLength, loopMode, isAutoPlay = false) {
    const loopLabel = getLoopLabel(loopMode);
    const sourceLabel = getSourceLabel(track.uri);
    const duration = track.isStream ? 'Live 🔴' : formatDuration(track.duration);

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🎵 กำลังเล่นอยู่ตอนนี้')
        .setDescription(`### [${track.title}](${track.uri})`)
        .addFields(
            { name: '🎤 ศิลปิน', value: track.author, inline: true },
            { name: '⏱️ ความยาว', value: duration, inline: true },
            { name: '📡 แหล่งที่มา', value: sourceLabel, inline: true },
            { name: '👤 รีเควสโดย', value: track.requester, inline: true },
            { name: '📋 เพลงในคิว', value: `${Math.max(0, queueLength - 1)} เพลง`, inline: true },
            { name: '🔁 โหมดลูป', value: loopLabel, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: isAutoPlay ? 'เล่นต่อจากคิวอัตโนมัติ' : 'Alan The Grandmaster 🎶' });

    if (track.artworkUrl) {
        embed.setThumbnail(track.artworkUrl);
    }

    return embed;
}

// Build "Added to Queue" embed
function buildAddedToQueueEmbed(track, position) {
    const duration = track.isStream ? 'Live 🔴' : formatDuration(track.duration);
    const sourceLabel = getSourceLabel(track.uri);

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('➕ เพิ่มลงคิวแล้ว')
        .setDescription(`### [${track.title}](${track.uri})`)
        .addFields(
            { name: '🎤 ศิลปิน', value: track.author, inline: true },
            { name: '⏱️ ความยาว', value: duration, inline: true },
            { name: '📡 แหล่งที่มา', value: sourceLabel, inline: true },
            { name: '👤 รีเควสโดย', value: track.requester, inline: true },
            { name: '🔢 ตำแหน่งในคิว', value: `#${position}`, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Alan The Grandmaster 🎶' });

    if (track.artworkUrl) {
        embed.setThumbnail(track.artworkUrl);
    }

    return embed;
}

// ==========================================
// PLAY
// ==========================================
async function executePlay(interaction, shoukaku, queues, leaveTimeouts, loopModes) {
    await interaction.deferReply();
    clearLeaveTimer(interaction.guildId, leaveTimeouts);

    const query = interaction.options.getString('song');
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
        return interaction.editReply({ embeds: [
            new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ คุณต้องเข้าห้องเสียง (Voice Channel) ก่อนครับ!')
        ]});
    }

    const node = shoukaku.options.nodeResolver(shoukaku.nodes);
    if (!node) {
        return interaction.editReply({ embeds: [
            new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ ระบบเสียงยังไม่พร้อมใช้งานครับ')
        ]});
    }

    try {
        const isUrl = query.startsWith('http://') || query.startsWith('https://');
        let result = null;

        if (isUrl) {
            result = await node.rest.resolve(query);
        } else {
            const searchPrefixes = ['ytmsearch:', 'ytsearch:', 'scsearch:'];
            for (const prefix of searchPrefixes) {
                const tempResult = await node.rest.resolve(`${prefix}${query}`);
                if (tempResult && tempResult.loadType !== 'empty' && tempResult.loadType !== 'error') {
                    result = tempResult;
                    break;
                }
            }
        }

        if (!result || result.loadType === 'empty' || result.loadType === 'error') {
            return interaction.editReply({ embeds: [
                new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ ค้นหาเพลงไม่พบ หรือแพลตฟอร์มปฏิเสธการดึงข้อมูลครับ')
            ]});
        }

        const trackInfo = extractTrackInfo(result);
        const newTrack = { ...trackInfo, requester: interaction.user.username };

        let player = shoukaku.players.get(interaction.guildId);

        if (!player) {
            try {
                player = await shoukaku.joinVoiceChannel({
                    guildId: interaction.guildId,
                    channelId: voiceChannel.id,
                    shardId: interaction.guild.shard?.id ?? 0,
                    deaf: true
                });
            } catch (joinError) {
                console.error('Failed to join voice channel:', joinError);
                return interaction.editReply({ embeds: [
                    new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ ไม่สามารถเข้าห้องเสียงได้ครับ กรุณาลองใหม่อีกครั้ง')
                ]});
            }

            await new Promise(resolve => setTimeout(resolve, 500));

            player.on('end', (payload) => {
                if (payload.reason === 'finished') {
                    const currentLoop = loopModes.get(interaction.guildId) || 'OFF';
                    const serverQueue = queues.get(interaction.guildId);

                    if (!serverQueue) return;

                    if (currentLoop === 'SONG') {
                        // Keep serverQueue[0]
                    } else if (currentLoop === 'QUEUE') {
                        const finishedSong = serverQueue.shift();
                        serverQueue.push(finishedSong);
                    } else {
                        serverQueue.shift();
                    }

                    if (serverQueue.length > 0) {
                        const nextTrack = serverQueue[0];
                        player.playTrack({ track: { encoded: nextTrack.encoded } });

                        const loopMode = loopModes.get(interaction.guildId) || 'OFF';
                        const embed = buildNowPlayingEmbed(nextTrack, serverQueue.length, loopMode, true);
                        interaction.channel.send({ embeds: [embed] });
                    } else {
                        const embed = new EmbedBuilder()
                            .setColor(0xE67E22)
                            .setTitle('📭 คิวเพลงหมดแล้ว')
                            .setDescription('ไม่มีเพลงในคิวแล้วครับ ถ้าไม่มีเพลงเพิ่มใน **5 นาที** ผมจะออกจากห้องนะ')
                            .setTimestamp();
                        interaction.channel.send({ embeds: [embed] });
                        startLeaveTimer(interaction.guildId, shoukaku, queues, leaveTimeouts, interaction.channel);
                    }
                }
            });

            player.on('error', (err) => console.error('เกิดข้อผิดพลาดกับ Player: ', err));
        }

        if (!queues.has(interaction.guildId)) {
            queues.set(interaction.guildId, []);
        }

        const serverQueue = queues.get(interaction.guildId);
        serverQueue.push(newTrack);

        if (serverQueue.length === 1) {
            try {
                await player.playTrack({ track: { encoded: serverQueue[0].encoded } });
                const loopMode = loopModes.get(interaction.guildId) || 'OFF';
                const embed = buildNowPlayingEmbed(serverQueue[0], serverQueue.length, loopMode);
                interaction.editReply({ embeds: [embed] });
            } catch (playErr) {
                console.error('Failed to play track immediately:', playErr);
                interaction.editReply({ embeds: [
                    new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ เกิดข้อผิดพลาดในการเล่นเพลงครับ')
                ]});
                serverQueue.shift();
            }
        } else {
            const position = serverQueue.length - 1;
            const embed = buildAddedToQueueEmbed(newTrack, position);
            interaction.editReply({ embeds: [embed] });
        }

    } catch (error) {
        console.error(error);
        interaction.editReply({ embeds: [
            new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ เกิดข้อผิดพลาดในระบบ (เช็ค Log)')
        ]});
    }
}

// ==========================================
// QUEUE
// ==========================================
async function executeQueue(interaction, queues) {
    const serverQueue = queues.get(interaction.guildId);

    if (!serverQueue || serverQueue.length === 0) {
        return interaction.reply({ embeds: [
            new EmbedBuilder().setColor(0xE67E22).setDescription('📭 ตอนนี้ยังไม่มีเพลงในคิวครับ')
        ]});
    }

    const nowPlaying = serverQueue[0];
    const upcoming = serverQueue.slice(1);

    let upcomingText = upcoming.length > 0
        ? upcoming.slice(0, 10).map((t, i) => `\`${i + 1}.\` [${t.title}](${t.uri || '#'}) — ${t.requester}`).join('\n')
        : '*ไม่มีเพลงในคิว*';

    if (upcoming.length > 10) {
        upcomingText += `\n*...และอีก ${upcoming.length - 10} เพลง*`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📋 รายการเพลงในคิว')
        .addFields(
            {
                name: '🎵 กำลังเล่นอยู่',
                value: `[${nowPlaying.title}](${nowPlaying.uri || '#'}) — ${nowPlaying.requester}`,
            },
            {
                name: `⏭️ เพลงถัดไป (${upcoming.length} เพลง)`,
                value: upcomingText,
            }
        )
        .setTimestamp()
        .setFooter({ text: `รวมทั้งหมด ${serverQueue.length} เพลง` });

    if (nowPlaying.artworkUrl) embed.setThumbnail(nowPlaying.artworkUrl);

    interaction.reply({ embeds: [embed] });
}

// ==========================================
// SKIP
// ==========================================
async function executeSkip(interaction, shoukaku, queues, leaveTimeouts, loopModes) {
    const player = shoukaku.players.get(interaction.guildId);
    if (!player) {
        return interaction.reply({ embeds: [
            new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ ตอนนี้บอทยังไม่ได้เล่นเพลงอะไรเลยครับ!')
        ], ephemeral: true });
    }

    const userVoiceChannel = interaction.member.voice.channel;
    const botVoiceChannel = interaction.guild.members.me.voice.channel;

    if (!userVoiceChannel || (botVoiceChannel && userVoiceChannel.id !== botVoiceChannel.id)) {
        return interaction.reply({ embeds: [
            new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ คุณต้องอยู่ในห้องเสียงเดียวกับผมถึงจะสั่งข้ามเพลงได้ครับ!')
        ], ephemeral: true });
    }

    const serverQueue = queues.get(interaction.guildId);
    if (!serverQueue || serverQueue.length <= 1) {
        return interaction.reply({ embeds: [
            new EmbedBuilder().setColor(0xE67E22).setDescription('⚠️ ไม่มีเพลงในคิวให้ข้ามครับ!')
        ]});
    }

    const skippedTrack = serverQueue[0];
    const currentLoop = loopModes.get(interaction.guildId) || 'OFF';

    if (currentLoop === 'QUEUE') {
        const skippedSong = serverQueue.shift();
        serverQueue.push(skippedSong);
    } else {
        serverQueue.shift();
    }

    if (serverQueue.length > 0) {
        const nextTrack = serverQueue[0];
        await player.playTrack({ track: { encoded: nextTrack.encoded } });

        const loopMode = loopModes.get(interaction.guildId) || 'OFF';
        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('⏭️ ข้ามเพลงแล้ว')
            .addFields(
                { name: '⏭️ ข้ามเพลง', value: skippedTrack.title, inline: false },
                { name: '🎵 กำลังเล่น', value: `[${nextTrack.title}](${nextTrack.uri || '#'})`, inline: false },
                { name: '🎤 ศิลปิน', value: nextTrack.author, inline: true },
                { name: '⏱️ ความยาว', value: formatDuration(nextTrack.duration), inline: true },
                { name: '👤 รีเควสโดย', value: nextTrack.requester, inline: true },
                { name: '🔁 โหมดลูป', value: getLoopLabel(loopMode), inline: true },
                { name: '📋 เพลงในคิว', value: `${Math.max(0, serverQueue.length - 1)} เพลง`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: `สั่งข้ามโดย ${interaction.user.username}` });

        if (nextTrack.artworkUrl) embed.setThumbnail(nextTrack.artworkUrl);

        interaction.reply({ embeds: [embed] });
    } else {
        await player.stopTrack();
        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('⏭️ ข้ามเพลงแล้ว — คิวว่างเปล่า')
            .setDescription(`ข้าม **${skippedTrack.title}** แล้ว ตอนนี้คิวว่างเปล่าครับ\nถ้าไม่มีเพลงเพิ่มใน **5 นาที** ผมจะออกจากห้องนะ`)
            .setTimestamp()
            .setFooter({ text: `สั่งข้ามโดย ${interaction.user.username}` });

        interaction.reply({ embeds: [embed] });
        startLeaveTimer(interaction.guildId, shoukaku, queues, leaveTimeouts, interaction.channel);
    }
}

// ==========================================
// LOOP
// ==========================================
async function executeLoop(interaction, loopModes) {
    const mode = interaction.options.getString('mode');
    loopModes.set(interaction.guildId, mode);

    const descriptions = {
        'OFF':   { label: '➡️ ปิดการวนซ้ำ', color: 0x95A5A6, desc: 'ปิดการวนซ้ำเรียบร้อยแล้วครับ' },
        'SONG':  { label: '🔂 วนซ้ำเพลงเดียว', color: 0x3498DB, desc: 'ตั้งค่าวนซ้ำ **เพลงเดียว** เรียบร้อยแล้วครับ' },
        'QUEUE': { label: '🔁 วนซ้ำทั้งคิว', color: 0x9B59B6, desc: 'ตั้งค่าวนซ้ำ **ทั้งคิว** เรียบร้อยแล้วครับ' },
    };

    const { label, color, desc } = descriptions[mode];

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(label)
        .setDescription(desc)
        .setTimestamp()
        .setFooter({ text: `ตั้งค่าโดย ${interaction.user.username}` });

    interaction.reply({ embeds: [embed] });
}

// ==========================================
// DISCONNECT
// ==========================================
async function executeDisconnect(interaction, shoukaku, queues, leaveTimeouts, loopModes) {
    const player = shoukaku.players.get(interaction.guildId);
    if (!player) {
        return interaction.reply({ embeds: [
            new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ บอทยังไม่ได้อยู่ในห้องเสียงเลยครับ!')
        ], ephemeral: true });
    }

    const userVoiceChannel = interaction.member.voice.channel;
    const botVoiceChannel = interaction.guild.members.me.voice.channel;

    if (!userVoiceChannel || (botVoiceChannel && userVoiceChannel.id !== botVoiceChannel.id)) {
        return interaction.reply({ embeds: [
            new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ คุณต้องอยู่ในห้องเสียงเดียวกับผมถึงจะสั่งให้ออกได้ครับ!')
        ], ephemeral: true });
    }

    clearLeaveTimer(interaction.guildId, leaveTimeouts);
    queues.delete(interaction.guildId);
    loopModes.delete(interaction.guildId);
    await shoukaku.leaveVoiceChannel(interaction.guildId);

    const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('👋 ออกจากห้องเสียงแล้ว')
        .setDescription('ล้างคิวและออกจากห้องเรียบร้อยแล้วครับ ไปก่อนนะ บาย~ 👋')
        .setTimestamp()
        .setFooter({ text: `สั่งโดย ${interaction.user.username}` });

    return interaction.reply({ embeds: [embed] });
}

module.exports = {
    executePlay,
    executeQueue,
    executeSkip,
    executeDisconnect,
    executeLoop
};
