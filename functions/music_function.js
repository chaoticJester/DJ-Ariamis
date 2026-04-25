// ฟังก์ชันช่วย: ยกเลิกการจับเวลา
function clearLeaveTimer(guildId, leaveTimeouts) {
    if (leaveTimeouts.has(guildId)) {
        clearTimeout(leaveTimeouts.get(guildId));
        leaveTimeouts.delete(guildId);
    }
}

// ฟังก์ชันช่วย: เริ่มจับเวลา 5 นาที
function startLeaveTimer(guildId, shoukaku, queues, leaveTimeouts, channel) {
    clearLeaveTimer(guildId, leaveTimeouts);
    
    const timeout = setTimeout(async () => {
        const player = shoukaku.players.get(guildId);
        if (player) {
            await shoukaku.leaveVoiceChannel(guildId);
            queues.delete(guildId);
            leaveTimeouts.delete(guildId);
            channel.send('⏳ ไม่มีเพลงเล่นเกิน 5 นาที ผมขอตัวออกจากห้องก่อนนะครับ บาย');
            console.log(`[Auto-Leave] ออกจากห้อง ${guildId} เพราะไม่มีเพลงเล่น`);
        }
    }, 5 * 60 * 1000);

    leaveTimeouts.set(guildId, timeout);
}

// ==========================================

// Function signature mapping the objects in your script 
async function executePlay(interaction, shoukaku, queues, leaveTimeouts, loopModes) {
    await interaction.deferReply();
    clearLeaveTimer(interaction.guildId, leaveTimeouts);

    const query = interaction.options.getString('song');
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) return interaction.editReply('คุณต้องเข้าห้องเสียง (Voice Channel) ก่อนครับ!');

    const node = shoukaku.options.nodeResolver(shoukaku.nodes);
    if (!node) return interaction.editReply('ระบบเสียงยังไม่พร้อมใช้งานครับ');

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
            return interaction.editReply('ค้นหาเพลงไม่พบ หรือแพลตฟอร์มปฏิเสธการดึงข้อมูลครับ');
        }

        let trackToPlay, title;

        if (result.loadType === 'playlist') {
            trackToPlay = result.data.tracks[0].encoded;
            title = result.data.tracks[0].info.title;
        } else if (result.loadType === 'search') {
            trackToPlay = result.data[0].encoded;
            title = result.data[0].info.title;
        } else if (result.loadType === 'track') {
            trackToPlay = result.data.encoded;
            title = result.data.info.title;
        }

        const newTrack = {
            encoded: trackToPlay,
            title: title,
            requester: interaction.user.username
        };

        let player = shoukaku.players.get(interaction.guildId);

        // 1. Establish the connection first if it doesn't exist
        if(!player) {
		
            try {
                player = await shoukaku.joinVoiceChannel({
                    guildId: interaction.guildId,
                    channelId: voiceChannel.id,
                    shardId: interaction.guild.shard?.id ?? 0,
                    deaf: true
                });
            } catch (joinError) {
                console.error('Failed to join voice channel:', joinError);
                return interaction.editReply('ไม่สามารถเข้าห้องเสียงได้ครับ กรุณาลองใหม่อีกครั้ง');
            }
            // Wait for node stability 
            await new Promise(resolve => setTimeout(resolve, 500));

            player.on('end', (payload) => {
                if(payload.reason === 'finished') {
                    const currentLoop = loopModes.get(interaction.guildId) || 'OFF';
                    const serverQueue = queues.get(interaction.guildId);

                    if(!serverQueue) return;

                    if (currentLoop === 'SONG') {
                        // Keep serverQueue[0]
                    } else if (currentLoop === 'QUEUE') {
                        const finishedSong = serverQueue.shift();
                        serverQueue.push(finishedSong);
                    } else {
                        serverQueue.shift();
                    }

                    if(serverQueue.length > 0) {
                        const nextTrack = serverQueue[0];
                        player.playTrack({track : { encoded: nextTrack.encoded }});
                        interaction.channel.send(`กำลังเล่น **${serverQueue[0].title}** นะ\nรีเควสโดย ***${serverQueue[0].requester}***`);
                    } else {
                        interaction.channel.send('คิวเพลงหมดแล้วนะครับ (ถ้าไม่มีเพลงเพิ่มใน 5 นาทีผมจะออกจากห้องนะ)');
                        startLeaveTimer(interaction.guildId, shoukaku, queues, leaveTimeouts, interaction.channel);
                    }
                }
            });

            player.on('error', (err) => console.error('เกิดข้อผิดพลาดกับ Player: ', err));
        }

        if(!queues.has(interaction.guildId)) {
            queues.set(interaction.guildId, []);
        }

        const serverQueue = queues.get(interaction.guildId);
        
        serverQueue.push(newTrack);

        if(serverQueue.length === 1) {
            try {
                await player.playTrack({track: {encoded: serverQueue[0].encoded}});
                interaction.editReply(`กำลังเล่น **${serverQueue[0].title}** นะ\nรีเควสโดย ***${serverQueue[0].requester}***`);
            } catch (playErr) {
                console.error("Failed to play track immediately:", playErr);
                interaction.editReply("เกิดข้อผิดพลาดในการเล่นเพลงครับ");
                serverQueue.shift();
            }
        } else {
            interaction.editReply(`เพิ่มเพลง **${newTrack.title}** ลงคิวแล้วนะ`);
        }

    } catch (error) {
        console.error(error);
        interaction.editReply('เกิดข้อผิดพลาดในระบบ (เช็ค Log)');
    }
}

async function executeQueue(interaction, queues) {
    const serverQueue = queues.get(interaction.guildId);

    if(!serverQueue || serverQueue.length <= 1) {
        return interaction.reply('ตอนนี้ยังไม่มีคิวครับ'); 
    }

    let queueString = "**รายการเพลงในคิว:**\n";
    // เริ่มที่ 1 เพราะ index 0 คือเพลงที่กำลังเล่นอยู่
    for(let i = 1; i < serverQueue.length; i++) {
        queueString += `${i}: ${serverQueue[i].title}\n`;
    }

    interaction.reply(queueString);
}

async function executeSkip(interaction, shoukaku, queues, leaveTimeouts, loopModes) {
    const player = shoukaku.players.get(interaction.guildId);
    if (!player) return interaction.reply({ content: 'ตอนนี้บอทยังไม่ได้เล่นเพลงอะไรเลยครับ!', ephemeral: true });

    const userVoiceChannel = interaction.member.voice.channel;
    const botVoiceChannel = interaction.guild.members.me.voice.channel;

    if (!userVoiceChannel || (botVoiceChannel && userVoiceChannel.id !== botVoiceChannel.id)) {
        return interaction.reply({ content: 'คุณต้องอยู่ในห้องเสียงเดียวกับผมถึงจะสั่งข้ามเพลงได้ครับ!', ephemeral: true });
    }

    const serverQueue = queues.get(interaction.guildId);
    if (!serverQueue || serverQueue.length <= 1) {
        return interaction.reply('ไม่มีเพลงในคิวให้ข้ามครับ!');
    }

    // ถ้าระบบลูปคิวอยู่ ข้ามเพลงก็ต้องเอาเพลงนี้ไปต่อท้ายด้วย
    const currentLoop = loopModes.get(interaction.guildId) || 'OFF';
    if (currentLoop === 'QUEUE') {
        const skippedSong = serverQueue.shift();
        serverQueue.push(skippedSong);
    } else {
        serverQueue.shift(); // นอกนั้นลบทิ้งไปเลย (แม้จะอยู่โหมด SONG สั่งข้ามก็ต้องไปเพลงต่อไป)
    }

    if (serverQueue.length > 0) {
        const nextTrack = serverQueue[0];
        interaction.reply(`มีคนสั่งข้ามเพลง กำลังเล่นเพลงถัดไป`);
        interaction.channel.send(`เล่น **${nextTrack.title}** นะ\nรีเควสโดย ***${nextTrack.requester}***`);
        await player.playTrack({ track: { encoded: nextTrack.encoded } });
    } else {
        await player.stopTrack();
        interaction.reply('️มีคนสั่งข้ามเพลง ตอนนี้คิวว่างเปล่าแล้วครับ (เริ่มจับเวลา 5 นาที)');
        startLeaveTimer(interaction.guildId, shoukaku, queues, leaveTimeouts, interaction.channel);
    }
}

// ฟังก์ชัน Loop
async function executeLoop(interaction, loopModes) {
    const mode = interaction.options.getString('mode');
    loopModes.set(interaction.guildId, mode);

    let modeMessage = '';
    if (mode === 'OFF') modeMessage = 'ปิดการวนซ้ำเรียบร้อยแล้ว';
    if (mode === 'SONG') modeMessage = 'ตั้งค่วนซ้ำ **เพลงเดียว** เรียบร้อยแล้ว';
    if (mode === 'QUEUE') modeMessage = 'ตั้งค่าวนซ้ำ **ทั้งคิว** เรียบร้อยแล้ว';

    interaction.reply(modeMessage);
}

async function executeDisconnect(interaction, shoukaku, queues, leaveTimeouts, loopModes) {
    const player = shoukaku.players.get(interaction.guildId);
    if (!player) return interaction.reply({ content: 'บอทยังไม่ได้อยู่ในห้องเสียงเลยครับ!', ephemeral: true });

    const userVoiceChannel = interaction.member.voice.channel;
    const botVoiceChannel = interaction.guild.members.me.voice.channel;

    if (!userVoiceChannel || (botVoiceChannel && userVoiceChannel.id !== botVoiceChannel.id)) {
        return interaction.reply({ content: 'คุณต้องอยู่ในห้องเสียงเดียวกับผมถึงจะสั่งให้ออกได้ครับ!', ephemeral: true });
    }

    clearLeaveTimer(interaction.guildId, leaveTimeouts);

    // ล้างข้อมูลทุกอย่าง
    queues.delete(interaction.guildId);
    loopModes.delete(interaction.guildId);
    await shoukaku.leaveVoiceChannel(interaction.guildId);
    
    return interaction.reply('ไปก่อนนะ บาย');
}

module.exports = {
    executePlay,
    executeQueue,
    executeSkip,
    executeDisconnect,
    executeLoop 
};
