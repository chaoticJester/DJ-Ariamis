const { Client, GatewayIntentBits, ApplicationCommandOptionType } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');
const musicCommands = require('./functions/music_function');

require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
        // ไม่จำเป็นต้องใช้ MessageContent แล้วถ้ารับแค่ Slash Command
    ]
});

const nodes = [{
    name: 'Ariamis Trianglecat The Grandmaster',
    url: 'localhost:2333',
    auth: process.env.LAVALINK_PASS 
}];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes);

shoukaku.on('error', (_, error) => console.error('Shoukaku Error:', error));
shoukaku.on('ready', (name) => console.log(`Lavalink Node: ${name} is now connected`));

const queues = new Map();

// เมื่อบอทพร้อมทำงาน
client.once('ready', async () => {
    console.log(`Alan is now on ${client.user.tag}!`);

    // --- ส่วนลงทะเบียน Slash Commands ---
    const commands = [
        {
            name: 'play',
            description: 'เล่นเพลงตามที่คุณต้องการ',
            options: [
                {
                    name: 'song',
                    type: ApplicationCommandOptionType.String,
                    description: 'ชื่อเพลงหรือ URL ที่ต้องการฟัง',
                    required: true, // บังคับให้ผู้ใช้ต้องกรอกช่องนี้
                }
            ]
        },
        { name: 'queue', description: 'ดูรายการเพลงในคิวปัจจุบัน' },
        { name: 'skip', description: 'ข้ามเพลงที่กำลังเล่นอยู่' },
        { name: 'disconnect', description: 'สั่งให้ออกจากห้องเสียงและล้างคิว' }
    ];

    // ส่งข้อมูลคำสั่งไปบอกเซิร์ฟเวอร์ Discord
    await client.application.commands.set(commands);
    console.log('ลงทะเบียน Slash Commands เรียบร้อยแล้ว!');
});

// ระบบรับ Slash Commands
client.on('interactionCreate', async interaction => {
    // ถ้าไม่ใช่ Slash Command ให้ข้ามไป
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'play') {
        await musicCommands.executePlay(interaction, shoukaku, queues);
    } 
    else if (commandName === 'queue') {
        await musicCommands.executeQueue(interaction, queues);
    } 
    else if (commandName === 'skip') {
        await musicCommands.executeSkip(interaction, shoukaku, queues);
    } 
    else if (commandName === 'disconnect') {
        await musicCommands.executeDisconnect(interaction, shoukaku, queues);
    }
});

client.login(process.env.TOKEN);