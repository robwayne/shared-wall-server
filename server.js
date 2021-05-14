const express = require('express');
const { check, matchedData  } = require('express-validator')
const app = express();
const http = require('http').createServer(app);
const cors =  {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
        transports: ['websocket', 'polling'],
        credentials: true
    },
    allowEIO3: true
};
const io = require('socket.io')(http, cors);
const path = require('path');

const users = {};
const sentData = {};
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
let availableCells = '1111111111'; 
const port = process.env.PORT || 3000;
const replaceAt = (str, index, char) => {
    return str.substr(0, index) + char + str.substr(index + char.length);
}

//TODO: change
const rootPW = "123654";

let masterUsername = "";
let masterLoggedIn = false;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('port', port);

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
        } else {
          console.log('Sent:', 'master')
        }
    });
});

app.post(
    '/master', 
    check('masterPassword').trim().not().isEmpty().escape().isAlphanumeric(),
    check('id').optional({checkFalsy: true}).escape(),
    check('projector').optional({checkFalsy: true}).isInt(),
    (req, res, next) => {
        const  { masterPassword } = matchedData(req, { locations: ['body'] });
        if (masterPassword && masterPassword === rootPW) {
            const  { id, projector } = matchedData(req, { locations: ['query'] });
            let redirectPath = '/console?mu=' + masterUsername;
            redirectPath += id ? `&id=${id}` : '';
            redirectPath += projector ? `&projector=${parseInt(projector)}` : '';
            console.log("path", redirectPath);
            res.redirect(redirectPath);
        } else {
            res.sendStatus(403);
        }
    }   
);

app.get('/console', (req, res, next) => {

    if (masterLoggedIn) {
        res.sendStatus(403);
        return;
    }

    const { query: { mu: username }} = req;
    console.log('GOT USERNAME', username);

    if (username && masterUsername === username) {
        const options = {
            root: path.join(__dirname, 'public'),
            headers: {
                'x-timestamp': Date.now(),
                'x-sent': true
            }
        };
        
        res.sendFile('console-root.html', options, (err) => {
            if (err) {
                console.log("error sending console file", username)
                next(err);
                return;
            } else {
                console.log('Sent:', 'console')
            }
        });

        masterLoggedIn = true;
    } else {
        res.redirect('/');
    }
});

const cleanuponDisconnect = (socket) => {
    if (socket && users[socket.id]) {
        const { activeCell } = users[socket.id];
        if (activeCell >= 0) {
            availableCells = replaceAt(availableCells, activeCell, '1');
        }
        delete users[socket.id];
    }
}

// MARK: SOCKET IO
io.sockets.on('connection', (socket) => {
    console.log('a user connected');
    socket.emit('availableCells', availableCells);
    if (!users[socket.id]) {
        users[socket.id] = {socket, activeCell: -1}; 
        socket.on('disconnect', () => {
            cleanuponDisconnect(socket);
        });
    }

    socket.on('mouse', (data) => {
        const { canvasIndex } = data;
        if (!sentData[canvasIndex]) {
            sentData[canvasIndex] = [];
        }
        sentData[canvasIndex].push(data);
        socket.broadcast.emit('mouse', data)
    }); 
    
    socket.on('relinquishCell', (data, acknowledgementCallback) => {
        const { socketID, activeCell } = data;
        // acknowledgementCallback("SERVER trying to relinquish" + activeCell + socketID);
        if (socketID && availableCells[activeCell] == '0') {
            const userData = users[socketID];
            if (userData && userData.activeCell === activeCell) {
                users[socketID].activeCell = -1;
                availableCells = replaceAt(availableCells, activeCell, '1');
                acknowledgementCallback('ok');
                io.emit('availableCells', availableCells); 
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
            }
        }
    });

    socket.on('disconnectClient', (data, ackCallback) => {
        console.log('disconnectClient');
        const { disonnectClientIndex: clientIndex, username: clientMaster} = data;
        const usersKeys = Object.keys(users);
        // TODO: GET CLIENTS SOCKET ID AND DISCONNECT IT BASED ON THAT
        if (clientMaster === masterUsername) {
            if (usersKeys.length > 1) {
                if (clientIndex && clientIndex >= 0 && clientIndex < availableCells.length) {
                    const sock = usersKeys.map((key) => {
                        if (users[key].activeCell === clientIndex) {
                            return users[key].socket;
                        }
                    }).filter((s) => s)[0];
                    console.log("socket to disconnect", sock);
                    if (sock) {
                        ackCallback("ok");
                        sock.disconnect(true);
                        cleanuponDisconnect(sock);
                    } else {
                        ackCallback("Invalid socket for requested client");
                    }
                } else {
                    ackCallback("Invalid `disconnectClientIndex` provided")
                }
            } else {
                ackCallback("No other clients connected.")
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });

    socket.on('clearClientDrawing', (data, ackCallback) => {
        console.log('disconnectClient');
        const { clientIndex, username: clientMaster } = data;
        const usersKeys = Object.keys(users);
        // TODO: GET CLIENTS SOCKET ID AND DISCONNECT IT BASED ON THAT
        if (clientMaster === masterUsername) {
            if (usersKeys.length > 1) {
                if (clientIndex >= 0 && clientIndex < availableCells.length) {
                    const sock = usersKeys.map((key) => {
                        if (users[key].activeCell === clientIndex) {
                            return users[key].socket;
                        }
                    }).filter((socket) => socket)[0];
    
                    if (sock) {
                        sock.emit('clear', { clearNow: true}, (status) => {
                            ackCallback(status);
                        })
                    } else {
                        ackCallback("Invalid socket for requested client");
                    }
                } else {
                    ackCallback("Invalid `disconnectClientIndex` provided")
                }
            } else {
                ackCallback("No other clients connected.")
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });


    socket.on('messageClient', (data, ackCallback) => {
        const { clientIndex, username: clientMaster, messageForClient } = data;
        const usersKeys = Object.keys(users);
        // TODO: GET CLIENTS SOCKET ID AND DISCONNECT IT BASED ON THAT
        if (clientMaster === masterUsername) {
            if (usersKeys.length > 1) {
                if (clientIndex >= 0 && clientIndex < availableCells.length) {
                    let sock = usersKeys.map((key) => {
                        return (users[key].activeCell === clientIndex) ? users[key].socket : null;
                    }).filter((s) => s !== null)[0];
                    if (sock) {
                        sock.emit('msgFromController', { controllerMessage: messageForClient })
                        ackCallback("ok");
                    } else {
                        ackCallback("Invalid socket for requested client");
                    }
                } else {
                    ackCallback("Invalid `disconnectClientIndex` provided")
                }
            } else {
                ackCallback("No other clients connected.")
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });


})

const generateMasterUsername = () => {
    if (masterUsername.length) masterUsername = "";
    for(let i=0;i<16;i++) {
        const index = Math.round(Math.random() * (alphabet.length - 1));
        const c = index % masterUsername.length === 0 ? alphabet[index].toUpperCase() : alphabet[index].toLowerCase();
        masterUsername += c;
    }
    console.log(masterUsername)
};

http.listen(port, () => {
  generateMasterUsername();
  console.log('listening on *:', port);
});
