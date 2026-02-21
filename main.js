const { Client, GatewayIntentBits, ApplicationCommandOptionType } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');
const musicCommands = require('./functions/music_function');

require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
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
const leaveTimeouts = new Map();
const loopModes = new Map(); // เพิ่มตัวแปรเก็บสถานะ Loop

client.once('ready', async () => {
    console.log(`Alan is now on ${client.user.tag}!`);

    const commands = [
        {
            name: 'play',
            description: 'เล่นเพลงตามที่คุณต้องการ',
            options: [
                {
                    name: 'song',
                    type: ApplicationCommandOptionType.String,
                    description: 'ชื่อเพลงหรือ URL ที่ต้องการฟัง',
                    required: true, 
                }
            ]
        },
        { name: 'queue', description: 'ดูรายการเพลงในคิวปัจจุบัน' },
        { name: 'skip', description: 'ข้ามเพลงที่กำลังเล่นอยู่' },
        { name: 'disconnect', description: 'สั่งให้ออกจากห้องเสียงและล้างคิว' },
        {
            name: 'loop',
            description: 'ตั้งค่าการวนซ้ำเพลง',
            options: [
                {
                    name: 'mode',
                    type: ApplicationCommandOptionType.String,
                    description: 'เลือกรูปแบบการวนซ้ำ',
                    required: true,
                    choices: [
                        { name: 'Off', value: 'OFF' },
                        { name: 'Song', value: 'SONG' },
                        { name: 'Queue', value: 'QUEUE' }
                    ]
                }
            ]
        }
    ];

    await client.application.commands.set(commands);
    console.log('ลงทะเบียน Slash Commands เรียบร้อยแล้ว!');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'play') {
        // ส่ง loopModes เข้าไปด้วย
        await musicCommands.executePlay(interaction, shoukaku, queues, leaveTimeouts, loopModes);
    } 
    else if (commandName === 'queue') {
        await musicCommands.executeQueue(interaction, queues);
    } 
    else if (commandName === 'skip') {
        await musicCommands.executeSkip(interaction, shoukaku, queues, leaveTimeouts, loopModes);
    } 
    else if (commandName === 'disconnect') {
        await musicCommands.executeDisconnect(interaction, shoukaku, queues, leaveTimeouts, loopModes);
    }
    else if (commandName === 'loop') {
        await musicCommands.executeLoop(interaction, loopModes);
    }
});

client.login(process.env.TOKEN);