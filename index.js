const { Client, GatewayIntentBits } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');

require('dotenv').config();

// ตั้งค่าบอทและ Intents (สิทธิ์การเข้าถึงข้อมูล)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// ตั้งค่าการเชื่อมต่อไปยัง Lavalink
const nodes = [{
    name: 'Ariamis Trianglecat The Grandmaster',
    url: 'localhost:2333',
    auth: process.env.LAVALINK_PASS 
}];

// เริ่มต้น Shoukaku
const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes);

shoukaku.on('error', (_, error) => console.error('Shoukaku Error:', error));
shoukaku.on('ready', (name) => console.log(`Lavalink Node: ${name} is now connected`));

const queues = new Map();


// เมื่อบอทพร้อมทำงาน
client.once('clientready', () => {
    console.log(`Alan is now on ${client.user.tag}!`);
});

// ระบบคำสั่งเล่นเพลงพื้นฐาน (!play)
client.on('messageCreate', async message => {
    // ป้องกันบอทคุยกันเอง หรือคำสั่งที่ไม่ได้เริ่มด้วย !play
    if (message.author.bot || !message.content.startsWith('!play')) return;

    const query = message.content.split(' ').slice(1).join(' '); // ดึงชื่อเพลง
    if (!query) return message.reply('กรุณาระบุชื่อเพลงด้วยครับ เช่น !play จี๋หอย');

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('คุณต้องเข้าห้องเสียง (Voice Channel) ก่อนครับ!');

    const node = shoukaku.options.nodeResolver(shoukaku.nodes);
    if (!node) return message.reply('ระบบเสียงยังไม่พร้อมใช้งานครับ');

    try {
        const isUrl = query.startsWith('http://') || query.startsWith('https://');
        
        let result = null; 

        if (isUrl) {
            console.log(`ค้นหาจาก URL โดยตรง...`);
            result = await node.rest.resolve(query);
        } else {
            // ถ้าเป็นชื่อเพลง ให้เรียงลำดับการค้นหา (Fallback Search)
            const searchPrefixes = [
                'ytmsearch:', // ลำดับที่ 1: YouTube Music 
                'ytsearch:',  // ลำดับที่ 3: YouTube ธรรมดา 
                'scsearch:'   // ลำดับที่ 4: SoundCloud 
            ];

            console.log(`กำลังค้นหาแบบเรียงลำดับ...`);

            for (const prefix of searchPrefixes) {
                console.log(`กำลังลองหาจาก: ${prefix}`);
                const tempResult = await node.rest.resolve(`${prefix}${query}`);

                // ถ้าเจอเพลง (ไม่ใช่ empty หรือ error) ให้เก็บผลลัพธ์แล้ว "หยุดลูปทันที" (break)
                if (tempResult && tempResult.loadType !== 'empty' && tempResult.loadType !== 'error') {
                    result = tempResult;
                    console.log(`เจอเพลงแล้ว! จากแพลตฟอร์ม: ${prefix}`);
                    break; 
                }
            }
        }

        if (!result || result.loadType === 'empty' || result.loadType === 'error') {
            return message.reply('ค้นหาเพลงไม่พบ หรือแพลตฟอร์มปฏิเสธการดึงข้อมูลครับ');
        }

        let trackToPlay;
        let title;

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

        // สร้าง object เก็บเพลง
        const newTrack = {
            encoded: trackToPlay,
            title: title,
            requester: message.author.username
        };

        if(!queues.has(message.guild.id)) {
            queues.set(message.guild.id, []);
        }

        const serverQueue = queues.get(message.guild.id);

        serverQueue.push(newTrack);

        let player = shoukaku.players.get(message.guild.id);

        if(!player) {
            console.log('อลันยังไม่ได้อยู่ในห้อง กำลังส่งเขาเข้าไป');
            player = await shoukaku.joinVoiceChannel({
                guildId: message.guild.id,
                channelId: voiceChannel.id,
                shardId: message.guild.shardId || 0
            });

            // Event ตอนเพลงเล่นจบ
            player.on('end', (payload) => {
                console.log(`เพลงเล่นจบแล้ว [Reason: ${payload.reason}]`);

                if(payload.reason == 'finished') {
                    serverQueue.shift();

                    if(serverQueue.length > 0) {
                        const nextTrack = serverQueue[0];
                        player.playTrack({track : { encoded: nextTrack.encoded }});
                        console.log(`อลันกำลังเล่นเพลง ${serverQueue[0].title}`);
                        message.channel.send(`กำลังเล่น **${serverQueue[0].title}** นะ\nรีเควสโดย ***${serverQueue[0].requester}***`);

                    } else {
                        message.channel.send('คิวเพลงหมดแล้วนะครับ'); 
                    }
                }
            });

            player.on('error', (err) => console.error('เกิดข้อผิดพลาดกับ Player: ', err));
        }

        if(serverQueue.length == 1) {
            await player.playTrack({track: {encoded: serverQueue[0].encoded}});
            console.log(`อลันกำลังเล่นเพลง ${serverQueue[0].title}`);
            message.channel.send(`กำลังเล่น **${serverQueue[0].title}** นะ\nรีเควสโดย ***${serverQueue[0].requester}***`);
        } else {
            message.reply(`เพิ่มเพลง **${newTrack.title}** ลงคิวแล้วนะ`);
        }

    } catch (error) {
        console.error(`\nเกิด Error ระบบ!`);
        console.error(error);
        message.reply('เกิดข้อผิดพลาดในระบบ (เช็ค Log)');
    }
});

// ระบบบอกคิวเพลง
client.on('messageCreate', async message => {
    if(message.author.bot) return;

    if(message.content === '!queue') {

        const serverQueue = queues.get(message.guild.id);

        if(!serverQueue || serverQueue.length == 0) {
            return message.reply('ตอนนี้ยังไม่มีคิวครับ');
        }

        let queueString = "**รายการเพลงในคิว:**\n";
        for(let i = 1; i < serverQueue.length; i++) {
            queueString += `${i}: ${serverQueue[i].title}\n`;
        }

        message.reply(queueString);
        console.log("บอกคิวไปแล้วนะ")
    }
})

// ระบบข้ามเพลง
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!skip') {
        // 1. ตรวจสอบว่าบอทกำลังทำงานในเซิร์ฟเวอร์นี้หรือไม่
        const player = shoukaku.players.get(message.guild.id);
        if (!player) {
            return message.reply('ตอนนี้บอทยังไม่ได้เล่นเพลงอะไรเลยครับ!');
        }

        // 2. ตรวจสอบว่าผู้ใช้อยู่ในห้องเสียงเดียวกับบอทไหม
        const userVoiceChannel = message.member.voice.channel;
        const botVoiceChannel = message.guild.members.me.voice.channel;

        if (!userVoiceChannel || (botVoiceChannel && userVoiceChannel.id !== botVoiceChannel.id)) {
            return message.reply('คุณต้องอยู่ในห้องเสียงเดียวกับผมถึงจะสั่งข้ามเพลงได้ครับ!');
        }

        // 3. ดึงข้อมูลคิวของเซิร์ฟเวอร์
        const serverQueue = queues.get(message.guild.id);

        if (!serverQueue || serverQueue.length === 0) {
            return message.reply('ไม่มีเพลงในคิวให้ข้ามครับ!');
        }

        // 4. นำเพลงที่กำลังเล่นอยู่ (คิวที่ 0) ออกจาก Array
        serverQueue.shift();

        // 5. เช็คว่ามีเพลงถัดไปรออยู่ไหม
        if (serverQueue.length > 0) {
            const nextTrack = serverQueue[0];
            
            // สั่งเล่นเพลงถัดไปทันที (Lavalink จะแทนที่เพลงเดิมให้เอง)
            message.reply(`มีคนสั่งข้ามเพลง กำลังเล่นเพลงถัดไป: **${nextTrack.title}**`);
            await player.playTrack({ track: { encoded: nextTrack.encoded } });
            console.log(`อลันกำลังเล่นเพลง ${nextTrack.title}`);
            message.channel.send(`กำลังเล่น **${serverQueue[0].title}** นะ\nรีเควสโดย ***${serverQueue[0].requester}***`);
        } else {
            // ถ้าคิวว่างเปล่าแล้ว ให้สั่งหยุดเล่น
            await player.stopTrack();
            message.reply('️มีคนสั่งข้ามเพลง ตอนนี้คิวว่างเปล่าแล้วครับ');
        }
    }
});

// ระบบคำสั่งให้ออกจากห้อง (!disconnect)
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!disconnect') {
        const player = shoukaku.players.get(message.guild.id);

        if (!player) {
            return message.reply('บอทยังไม่ได้อยู่ในห้องเสียงเลยครับ!');
        }

        const userVoiceChannel = message.member.voice.channel;
        const botVoiceChannel = message.guild.members.me.voice.channel;

        if (!userVoiceChannel || (botVoiceChannel && userVoiceChannel.id !== botVoiceChannel.id)) {
            return message.reply('คุณต้องอยู่ในห้องเสียงเดียวกับผมถึงจะสั่งให้ออกได้ครับ!');
        }

        // ล้างคิวของเซิร์ฟเวอร์นี้ทิ้ง
        queues.delete(message.guild.id);

        await shoukaku.leaveVoiceChannel(message.guild.id);
        
        console.log(`ปิดระบบการใช้งานและล้างคิว`);
        return message.reply('ไปก่อนนะ บาย');
    }
});

// ใส่ Token 
client.login(process.env.TOKEN);
