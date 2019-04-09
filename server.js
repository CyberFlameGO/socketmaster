const winston = require('winston');
const logger = winston.createLogger({
    level: 'info',
    transports: [
        //new winston.transports.File({ filename: 'socketmaster.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

const config = require('./config.json');

const express = require('express');
const http = require('http');
const url = require('url');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

const socketServers = {};

// serve a generic homepage
app.get('/', (req, res) => res.send('running socketmaster v1.0.0'));

// post endpoint for creating new sockets
app.post('/create', (req, res) => {
    const id = generateId(10);
    createServer(id);

    logger.info("[CREATE]");
    logger.info("    id = " + id);
    logger.info("    user agent = " + req.get("User-Agent"));
    logger.info("    origin = " + req.get("x-real-ip"));
    logger.info("");

    res.status(200).header("Location", config.socketHost + id).send();
});

server.on('upgrade', function (request, socket, head) {
    const pathname = url.parse(request.url).pathname;

    logger.info("[UPGRADE]");
    logger.info("    path = " + pathname);
    logger.info("    user agent = " + request.headers["user-agent"]);
    logger.info("    origin = " + request.headers["x-real-ip"]);

    if (!pathname || pathname.length <= 1) {
        logger.info("    status = invalid path");
        logger.info("");
        socket.destroy();
        return;
    }

    const server = getServer(pathname.substring(1));
    if (!server) {
        logger.info("    status = no such server");
        logger.info("");
        socket.destroy();
        return;
    }

    logger.info("    status = upgraded");
    logger.info("");

    server.handleUpgrade(request, socket, head, function (ws) {
        server.emit('connection', ws, request);
    });
});

// used for keepalive
function noop() {}
function heartbeat() { this.isAlive = true; }

function configureServer(wss, id) {
    wss.on('connection', function (ws, req) {
        const userAgent = req.headers["user-agent"];
        const origin = req.headers["x-real-ip"];

        logger.info("[CONNECTION OPEN]");
        logger.info("    id = " + id);
        logger.info("    user agent = " + userAgent);
        logger.info("    origin = " + origin);
        logger.info("");

        ws.on('message', function (data) {
            logger.info("[MESSAGE]");
            logger.info("    id = " + id);
            logger.info("    origin = " + origin);
            logger.info("    data = " + data);
            logger.info("");

            // re-send data to clients
            wss.clients.forEach(function (client) {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(data);
                }
            });
        });

        ws.on('close', function (code, reason) {
            logger.info("[CONNECTION CLOSE]");
            logger.info("    id = " + id);
            logger.info("    origin = " + origin);
            logger.info("    code = " + code);
            logger.info("    reason = " + reason);
            logger.info("");
        });

        ws.isAlive = true;
        ws.on('pong', heartbeat);
    });

    setInterval(function ping() {
        wss.clients.forEach(function (ws) {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping(noop);
        });
    }, config.pingInterval);
}

// create the server
server.listen(config.port, () => logger.info("Web server now started on :" + config.port));

function createServer(id) {
    let server = socketServers[id];
    if (!server) {
        server = new WebSocket.Server({ noServer: true });
        configureServer(server, id);
        socketServers[id] = server;
    }
    return server;
}

function generateId(length) {
    let text = "";
    const possible = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function getServer(id) {
    return socketServers[id];
}
