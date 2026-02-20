async function executePlay(interaction, shoukaku, queues) {
    // บอก Discord ว่าขอเวลาประมวลผลแป๊บนึง (ป้องกัน Error Timeout)
    await interaction.deferReply();

    // ดึงชื่อเพลงที่พิมพ์ในช่อง Slash Command
    const query = interaction.options.getString('song'); 

    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) return interaction.editReply('คุณต้องเข้าห้องเสียง (Voice Channel) ก่อนครับ!');

    const node = shoukaku.options.nodeResolver(shoukaku.nodes);
    if (!node) return interaction.editReply('ระบบเสียงยังไม่พร้อมใช้งานครับ');

    try {
        const isUrl = query.startsWith('http://') || query.startsWith('https://');
        let result = null; 

        if (isUrl) {
            console.log(`ค้นหาจาก URL โดยตรง...`);
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
            requester: interaction.user.username // เปลี่ยนจาก message.author เป็น interaction.user
        };

        if(!queues.has(interaction.guildId)) {
            queues.set(interaction.guildId, []);
        }

        const serverQueue = queues.get(interaction.guildId);
        serverQueue.push(newTrack);

        let player = shoukaku.players.get(interaction.guildId);

        if(!player) {
            console.log('อลันยังไม่ได้อยู่ในห้อง กำลังส่งเขาเข้าไป');
            player = await shoukaku.joinVoiceChannel({
                guildId: interaction.guildId,
                channelId: voiceChannel.id,
                shardId: interaction.guild.shardId || 0
            });

            player.on('end', (payload) => {
                console.log(`เพลงเล่นจบแล้ว [Reason: ${payload.reason}]`);
                if(payload.reason == 'finished') {
                    serverQueue.shift();
                    if(serverQueue.length > 0) {
                        const nextTrack = serverQueue[0];
                        player.playTrack({track : { encoded: nextTrack.encoded }});
                        interaction.channel.send(`กำลังเล่น **${serverQueue[0].title}** นะ\nรีเควสโดย ***${serverQueue[0].requester}***`);
                    } else {
                        interaction.channel.send('คิวเพลงหมดแล้วนะครับ'); 
                    }
                }
            });

            player.on('error', (err) => console.error('เกิดข้อผิดพลาดกับ Player: ', err));
        }

        if(serverQueue.length == 1) {
            await player.playTrack({track: {encoded: serverQueue[0].encoded}});
            // แก้ไขข้อความโหลดเป็นเพลงที่กำลังเล่น
            interaction.editReply(`กำลังเล่น **${serverQueue[0].title}** นะ\nรีเควสโดย ***${serverQueue[0].requester}***`);
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
        return interaction.reply('ตอนนี้ยังไม่มีคิวครับ'); // คำสั่งที่เร็ว ใช้ reply ได้เลยไม่ต้อง defer
    }

    let queueString = "**รายการเพลงในคิว:**\n";
    for(let i = 1; i < serverQueue.length; i++) {
        queueString += `${i}: ${serverQueue[i].title}\n`;
    }

    interaction.reply(queueString);
}

async function executeSkip(interaction, shoukaku, queues) {
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

    serverQueue.shift();

    if (serverQueue.length > 0) {
        const nextTrack = serverQueue[0];
        interaction.reply(`มีคนสั่งข้ามเพลง กำลังเล่นเพลงถัดไป: **${nextTrack.title}**`);
        await player.playTrack({ track: { encoded: nextTrack.encoded } });
    } else {
        await player.stopTrack();
        interaction.reply('️มีคนสั่งข้ามเพลง ตอนนี้คิวว่างเปล่าแล้วครับ');
    }
}

async function executeDisconnect(interaction, shoukaku, queues) {
    const player = shoukaku.players.get(interaction.guildId);
    if (!player) return interaction.reply({ content: 'บอทยังไม่ได้อยู่ในห้องเสียงเลยครับ!', ephemeral: true });

    const userVoiceChannel = interaction.member.voice.channel;
    const botVoiceChannel = interaction.guild.members.me.voice.channel;

    if (!userVoiceChannel || (botVoiceChannel && userVoiceChannel.id !== botVoiceChannel.id)) {
        return interaction.reply({ content: 'คุณต้องอยู่ในห้องเสียงเดียวกับผมถึงจะสั่งให้ออกได้ครับ!', ephemeral: true });
    }

    queues.delete(interaction.guildId);
    await shoukaku.leaveVoiceChannel(interaction.guildId);
    
    return interaction.reply('ไปก่อนนะ บาย');
}

module.exports = {
    executePlay,
    executeQueue,
    executeSkip,
    executeDisconnect
};