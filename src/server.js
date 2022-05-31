require('dotenv').config();

const path = require('path');
const events = require('events');
const child = require('child_process');
const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);

const spawn = child.spawn;
const exec = child.exec;

const Emitters = {};

const initEmitter = (feed) => {
    if (!Emitters[feed]) Emitters[feed] = new events.EventEmitter().setMaxListeners(0);
    return Emitters[feed];
};

const config = {
    debug: process.env.ENV ? process.env.ENV === 'dev' : false,
    port: process.env.APP_PORT || 8001,
    rtsp: process.env.RTSP_URL || 'rtsp://wowzaec2demo.streamlock.net/vod/mp4:BigBuckBunny_115k.mp4',
};

// web app
console.info(`${process.env.APP_NAME} starting server on port: ${config.port}`);
server.listen(config.port);

app.use(express.static(path.resolve(__dirname, '../public')));

app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

// ffmpeg pushed stream to make a pipe
app.all('/streamIn/:feed', (req, res) => {
  req.Emitter = initEmitter(req.params.feed); // Feed Number (Pipe Number)
  res.connection.setTimeout(0);
  req.on('data', (buffer) => {
    req.Emitter.emit('data', buffer);
    io.to('STREAM_'+req.params.feed).emit('h264', { feed: req.params.feed, buffer });
  });
  req.on('end', () => {
    if (config.debug) console.log('close');
  });
})

// socket.io client commands
io.on('connection', (cn) => {
    cn.on('f', (data) => {
        switch (data.function) {
            case 'getStream':
                if (config.debug) console.log(data);
                cn.join('STREAM_'+data.feed);
            break;
        }
    })
});

// simulate RTSP over HTTP
app.get(['/h264','/h264/:feed'], (req, res) => {
    if (!req.params.feed) req.params.feed = '1';
    req.Emitter = initEmitter(req.params.feed);
    var contentWriter;
    var date = new Date();
    res.writeHead(200, {
        'Date': date.toUTCString(),
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Content-Type': 'video/mp4',
        'Server': 'H.264 Test Stream',
    });
    req.Emitter.on('data', contentWriter = (buffer) => {
        res.write(buffer);
    });
    res.on('close', () => {
        req.Emitter.removeListener('data', contentWriter);
    });
});

// ffmpeg
if (config.debug) console.log('Starting FFMPEG');
var ffmpegString = '-i '+config.rtsp+'';
ffmpegString += ' -f mpegts -c:v mpeg1video -an http://localhost:'+config.port+'/streamIn/1';
ffmpegString += ' -f mpegts -c:v mpeg1video -an http://localhost:'+config.port+'/streamIn/2';
if (ffmpegString.indexOf('rtsp://')>-1) ffmpegString='-rtsp_transport tcp '+ffmpegString;
if (config.debug) console.log('Executing : ffmpeg '+ffmpegString);

var ffmpeg = spawn('ffmpeg', ffmpegString.split(' '));
ffmpeg.on('close', (buffer) => {
    if (config.debug) console.error('ffmpeg died');
})
ffmpeg.stderr.on('data', (buffer) => {
    //if (config.debug) console.log(buffer.toString());
});
ffmpeg.stdout.on('data', (buffer) => {
    Emitter.emit('data',buffer);
});
