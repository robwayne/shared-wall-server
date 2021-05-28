const bcrypt = require('bcrypt');
const cors = require('cors');
const express = require('express');
const { check, matchedData  } = require('express-validator');
const httpModule = require('http');
const path = require('path');
const socketIO = require('socket.io');

/* ----MARK: App Initializations ---- */
const app = express();
const originWhitelist = [/midarom\.herokuapp\.com$/, 'http://localhost:3000'];
const corsOptions =  {
    cors: {
        origin: originWhitelist,
        methods: ["GET", "POST"],
        transports: ['websocket', 'polling'],
        credentials: true
    },
    allowEIO3: true
}; 
const httpServer = httpModule.createServer(app);
const io = socketIO(httpServer, corsOptions);

/* ----MARK: App Local Variables ----  */
const users = {};
const cellSocketIds = new Array(10);
const urlCharset = "abcdefghijklmnopqrstuvwxyz0123456789-_~";
const sessionIDLength = 32;
let availableCells = '1111111111'; 
const port = process.env.PORT || 3000;


const replaceAt = (str, index, char) => {
    return str.substr(0, index) + char + str.substr(index + char.length);
};

let masterUsernameHash;
let masterLoggedIn = false;
let allCanvasMouseData = {};
let masterSocket;

/* ----MARK: Setup Middleware functionality for App ---- */
app.use(express.static('public'));
app.use(express.json());
app.use(cors(corsOptions));
app.use(express.urlencoded({ extended: true }));
app.set('port', port);
app.set('trust proxy', true);

//  Redirect all HTTP requests to HTTPS
app.use((req, res, next) => {  
    const { STAGE_ENV } = process.env;
    if (STAGE_ENV && STAGE_ENV === 'heroku' && !req.secure) { 
        return res.redirect(['https://', req.get('Host'), req.url].join(''));
    }
    next();
});

/* ----MARK: Setup App routes and handlers ---- */
app.get('/master', (req, res, next) => {
    const options = {
        root: path.join(__dirname, 'public'),
        headers: {
            'x-timestamp': Date.now(),
            'x-sent': true
        }
    };
    res.sendFile('master-login.html', options, (err) => {
        if (err) {
          next(err);
        }
    });
});

app.post(
    '/master', 
    check('masterPassword').trim().not().isEmpty().escape().isAlphanumeric(),
    check('id').optional({checkFalsy: true}).escape(),
    check('projector').optional({checkFalsy: true}).isInt(),
    (req, res, next) => {
        const  { masterPassword: passwordInput } = matchedData(req, { locations: ['body'] });
        let masterPasswordHash = process.env.MASTER_PW_HASH;
        if (!masterPasswordHash) {
            const { MASTER_PW_HASH: localHash } = require('./local-dev/credentials');
            masterPasswordHash = localHash;
        }
        if (passwordInput && !masterLoggedIn) {
            const isMatch = bcrypt.compareSync(passwordInput, masterPasswordHash);
            if (isMatch) {
                const  { id, projector } = matchedData(req, { locations: ['query'] });
                const masterUsername = genMasterUsernameHash();
                let redirectPath = '/console?sid=' + masterUsername;
                redirectPath += id ? `&id=${id}` : '';
                redirectPath += projector ? `&projector=${parseInt(projector)}` : '';
                return res.redirect(redirectPath);
            } else {
                return res.send('Incorrect Password. Refresh to ry again.');
            }
        } else {
            return res.sendStatus(403);
        }

        next();
    }   
);

app.get('/console', (req, res, next) => {

    if (masterLoggedIn) {
        res.sendStatus(403);
        return;
    }

    const { query: { sid }} = req;
    const isMatch = bcrypt.compareSync(sid, masterUsernameHash);
    if (isMatch) {
        const options = {
            root: path.join(__dirname, 'public'),
            headers: {
                'x-timestamp': Date.now(),
                'x-sent': true
            }
        };
        
        res.sendFile('console-root.html', options, (err) => {
            if (err) {
                console.err("error sending console file", sessionUsername)
                next(err);
                return;
            }
        });

        masterLoggedIn = true;
    } else {
        res.redirect('/');
    }
});

/* ----MARK: Private Methods ---- */

const genMasterUsernameHash = () => {
    let masterUsername = "";
    for(let i=0;i<sessionIDLength;i++) {
        const index = Math.round(Math.random() * (urlCharset.length - 1));
        const c = index % masterUsername.length === 0 ? urlCharset[index].toUpperCase() : urlCharset[index].toLowerCase();
        masterUsername += c;
    }

    const hashed = bcrypt.hashSync(masterUsername, 10);
    if (hashed) {
        masterUsernameHash = hashed;
    } else {
        masterUsernameHash = masterUsername;
    }

    return masterUsername;
};

const resetMaster = (socket) => {
    if (socket && masterSocket && socket.id === masterSocket.id) {
        masterSocket = null;
        masterLoggedIn = false;
    }
}

const cleanuponDisconnect = (socket) => {
    if (socket && users[socket.id]) {
        const { activeCell } = users[socket.id];
        if (activeCell >= 0 && availableCells[activeCell] != '2') {
            availableCells = replaceAt(availableCells, activeCell, '1');
        }
        resetMaster(socket);
        delete users[socket.id];
    }
};

const disconnectDrawingClient = (clientCellIndex, ackCallback) => {
    if (clientCellIndex >= 0 && clientCellIndex < cellSocketIds.length) {
        const clientSocketId = cellSocketIds[clientCellIndex];
        const clientCell = users[clientSocketId];
        if (clientCell && clientCell.socket) {
            if (masterSocket) {
                masterSocket.to(clientSocketId).emit('msgFromController', { controllerMessage: 'Your connection has been reset. Refresh in 5s to rejoin.' });
            }
            if (ackCallback) ackCallback("ok");
            clientCell.socket.disconnect(true);
            cleanuponDisconnect(clientCell.socket);
        } else {
            if (ackCallback) ackCallback("Invalid socket for requested client");
        }
    } else {
        if (ackCallback) ackCallback("Invalid `clientCellIndex` provided")
    }
}

const discconnectEventCallback = (event, data, ackCallback) => {
    const { username } = data;
    const isMatch = bcrypt.compareSync(username, masterUsernameHash);
    if (isMatch) {
        if (event === 'disconnectAllClients') {
            for(let i=0;i<cellSocketIds.length;i++) {
                disconnectDrawingClient(i);
            }
            ackCallback("ok");
        } else if (event === 'disconnectClient') {
            const { clientCellIndex } = data;
            if (clientCellIndex) {
                disconnectDrawingClient(clientCellIndex, ackCallback);
            } else {
                ackCallback("Invalid `clientCellIndex` provided");
            }   
        }
    } else {
        ackCallback("Unauthorized client username");
    }
};

/* ----MARK: Socket IO Events ---- */

io.sockets.on('connection', (socket) => {

    if (!users[socket.id]) {
        users[socket.id] = {socket, activeCell: -1};
    }

    socket.on('disconnect', () => {
        cleanuponDisconnect(socket);
        io.emit('availableCells', availableCells);
    });

    socket.on('registerUsername', ({username}) => {
        const isMatch = bcrypt.compareSync(username, masterUsernameHash);
        if (isMatch) {
            masterSocket = socket;
        }
    }); 

    socket.on('mouse', (data) => {
        const { canvasIndex } = data;
        if (!allCanvasMouseData[canvasIndex]) {
            allCanvasMouseData[canvasIndex] = [];
        }
        allCanvasMouseData[canvasIndex].push(data);
        socket.broadcast.emit('mouse', data)
    }); 
    
    socket.on('relinquishCell', (data, ackCallback) => {
        const { socketID, activeCell } = data;
        if (socketID && availableCells[activeCell] == '0') {
            const userData = users[socketID];
            if (userData && userData.activeCell === activeCell) {
                users[socketID].activeCell = -1;
                availableCells = replaceAt(availableCells, activeCell, '1');
                cellSocketIds[activeCell] = null;
                ackCallback(availableCells);
                socket.broadcast.emit('availableCells', availableCells); 
            }
        }
    });
    
    socket.on('requestCell', (data, ackCallback) => {
        const { socketID, requestedCell } = data;
        if (socketID && requestedCell >= 0 && requestedCell < availableCells.length) {
            if (availableCells.charAt(requestedCell) == '1') {
                users[socketID].activeCell = requestedCell;
                ackCallback(availableCells);
                availableCells = replaceAt(availableCells, requestedCell, '0');
                cellSocketIds[requestedCell] = socketID;
                socket.broadcast.emit('availableCells', availableCells);
            }
        }
    });

    socket.on('disconnectClient', (data, ackCallback) => {
        discconnectEventCallback('disconnectClient', data, ackCallback)
    });
    
    socket.on('disconnectAllClients', (data, ackCallback) => {
        socket.broadcast.emit('clearAllDrawings');
        discconnectEventCallback('disconnectAllClients', data, ackCallback);
        allCanvasMouseData = {};
    });

    socket.on('clearAll', (data, ackCallback) => {
        const { username } = data;
        if (username) {
            const isMatch = bcrypt.compareSync(username, masterUsernameHash);
            if (isMatch) {
                ackCallback("ok");
                allCanvasMouseData = {};
                socket.broadcast.emit('clearAllDrawings');
            } else {
                ackCallback("Unauthorized client username");
            }
        }
    });

    socket.on('clearClientDrawing', (data, ackCallback) => {
        const { clientCellIndex, username } = data;
        if (username) {
            const isMatch = bcrypt.compareSync(username, masterUsernameHash);
            if (isMatch) {
                if (allCanvasMouseData[clientCellIndex]) {
                    const cellMouseData = { clientCellIndex, pointsToClear: allCanvasMouseData[clientCellIndex] };
                    ackCallback("ok");
                    io.emit('clearDrawing', cellMouseData);
                    allCanvasMouseData[clientCellIndex] = [];
                } else {
                    ackCallback("Invalid `clientCellIndex` provided")
                }
            } else {
                ackCallback("Unauthorized client username");
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });

    socket.on('messageClient', (data, ackCallback) => {
        const { clientCellIndex, username, messageForClient } = data;
        if (username) {
            const isMatch = bcrypt.compareSync(username, masterUsernameHash);
            if (isMatch) {
                if (clientCellIndex >= 0 && clientCellIndex < cellSocketIds.length) {
                    let clientSocketId = cellSocketIds[clientCellIndex];
                    if (clientSocketId) {
                        socket.to(clientSocketId).emit('msgFromController', { controllerMessage: messageForClient })
                        ackCallback("ok");
                    } else {
                        ackCallback("Invalid socket for requested client");
                    }
                } else {
                    ackCallback("Invalid `clientCellIndex` provided")
                }
            } else {
                ackCallback("Unauthorized client username");
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });

    socket.on('disableCellForClients', (data, ackCallback) => {
        const { clientCellIndex, username } = data;
        if (username) {
            const isMatch = bcrypt.compareSync(username, masterUsernameHash);
            if (isMatch) {
                if (clientCellIndex >= 0 && clientCellIndex < availableCells.length) {
                    ackCallback("ok");
                    availableCells = replaceAt(availableCells, clientCellIndex, '2');
                    cellSocketIds[clientCellIndex] = null;
                    io.emit('availableCells', availableCells);
                } else {
                    ackCallback("Invalid `clientCellIndex` provided")
                }
            } else {
                ackCallback("Unauthorized client username");
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });
    
    socket.on('enableCellForClients', (data, ackCallback) => {
        const { clientCellIndex, username } = data;
        if (username) {
            const isMatch = bcrypt.compareSync(username, masterUsernameHash);
            if (isMatch) {
                if (clientCellIndex >= 0 && clientCellIndex < availableCells.length) {
                    ackCallback("ok");
                    availableCells = replaceAt(availableCells, clientCellIndex, '1');
                    cellSocketIds[clientCellIndex] = null;
                    socket.broadcast.emit('availableCells', availableCells);
                } else {
                    ackCallback("Invalid `clientCellIndex` provided")
                }
            } else {
                ackCallback("Unauthorized client username");
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });

    io.to(socket.id).emit('availableCells', availableCells);
    io.to(socket.id).emit('allCanvasMouseData', allCanvasMouseData);
});

httpServer.listen(port, () => {
  console.log('listening on *:', port);
});
