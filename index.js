const { Client, GatewayIntentBits } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');

require('dotenv').config();

// 1. ตั้งค่าบอทและ Intents (สิทธิ์การเข้าถึงข้อมูล)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// 2. ตั้งค่าการเชื่อมต่อไปยัง Lavalink
const nodes = [{
    name: 'Ariamis Trianglecat The Grandmaster',
    url: 'localhost:2333',
    auth: process.env.LAVALINK_PASS 
}];

// 3. เริ่มต้น Shoukaku
const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes);

shoukaku.on('error', (_, error) => console.error('Shoukaku Error:', error));
shoukaku.on('ready', (name) => console.log(`Lavalink Node: ${name} is now connected`));

// 4. เมื่อบอทพร้อมทำงาน
client.once('clientready', () => {
    console.log(`Alan is now on ${client.user.tag}!`);
});

// 5. ระบบคำสั่งเล่นเพลงพื้นฐาน (!play)
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

        console.log(`${trackToPlay ? 'มีข้อมูลพร้อมส่ง' : 'ว่างเปล่า (Undefined)'}`);

        // ดักจับถ้า trackToPlay ว่างเปล่า จะได้ไม่ส่งไปหา Lavalink ให้เกิด Error 400
        if (!trackToPlay) {
            return message.reply('เกิดข้อผิดพลาด: ไม่สามารถดึงรหัสเพลง (Encoded Track) ได้');
        }

        // ให้บอทเช็คว่าตัวเองอยู่ในห้องเสียงของเซิร์ฟเวอร์นี้หรือยัง?
        let player = shoukaku.players.get(message.guild.id);
        
        if (!player) {
            console.log(`บอทยังไม่ได้อยู่ในห้อง กำลังทำการเชื่อมต่อ...`);
            player = await shoukaku.joinVoiceChannel({
                guildId: message.guild.id,
                channelId: voiceChannel.id,
                shardId: message.guild.shardId || 0
            });

            player.on('end', (payload) => {
                console.log(`เพลงเล่นจบแล้ว! เหตุผล: ${payload.reason}`);
                
                // เช็คว่าจบแบบ "เล่นจนจบเพลงจริงๆ" (FINISHED) 
                // ไม่ใช่โดนกดข้าม (REPLACED) หรือโดนสั่งหยุด (STOPPED)
                if (payload.reason === 'FINISHED') {
                    message.channel.send('เล่นเพลงจบแล้วครับ!');
                    
                    //TODO: เอาเพลงถัดไปมาเล่น 
                }
            });

            player.on('error', (err) => {
                console.error(`เกิดข้อผิดพลาดกับ Player:`, err);
            });
        } else {
            console.log(`บอทอยู่ในห้องอยู่แล้ว ใช้การเชื่อมต่อเดิม`);
        }

        console.log(`ส่งคำสั่ง Play ไปที่ Lavalink...`);
        
        await player.playTrack({ track: { encoded: trackToPlay } });
        
        console.log(`บอทกำลังเล่นเพลง ${title}`);
        message.reply(`กำลังเล่น: **${title}** นะ`);

    } catch (error) {
        console.error(`\nเกิด Error ระบบ!`);
        console.error(error);
        message.reply('เกิดข้อผิดพลาดในระบบ (เช็ค Log)');
    }
});

// 6. ระบบคำสั่งให้ออกจากห้อง (!disconnect หรือ !leave)
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // เช็คว่าผู้ใช้พิมพ์ !disconnect 
    if (message.content === '!disconnect') {
        
        // เช็คก่อนว่าบอทมี Player ทำงานอยู่ในเซิร์ฟเวอร์นี้ไหม
        const player = shoukaku.players.get(message.guild.id);

        if (!player) {
            return message.reply('บอทยังไม่ได้อยู่ในห้องเสียงเลยครับ!');
        }

        const userVoiceChannel = message.member.voice.channel;
        const botVoiceChannel = message.guild.members.me.voice.channel;

        // ถ้าผู้ใช้ไม่ได้อยู่ห้องไหนเลย หรืออยู่คนละห้องกับบอท
        if (!userVoiceChannel || (botVoiceChannel && userVoiceChannel.id !== botVoiceChannel.id)) {
            return message.reply('คุณต้องอยู่ในห้องเสียงเดียวกับผมถึงจะสั่งให้ออกได้ครับ!');
        }

        // สั่งทำลาย Player และออกจากห้องเสียง (คืนทรัพยากรให้ระบบ)
        await shoukaku.leaveVoiceChannel(message.guild.id);
        
        console.log(`ปิดระบบการใช้งาน`);
        return message.reply('ไปก่อนนะ บาย');
    }
});

// ใส่ Token 
client.login(process.env.TOKEN);
