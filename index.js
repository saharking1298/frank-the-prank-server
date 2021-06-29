const httpServer = require('http').createServer();
const io = require('socket.io')(httpServer);
const fs = require('fs');
const PORT = 3000;

const saveFilePath = 'data/save.json';
const eventDelay = 10;
let hosts = [];
let remotes = [];
let connections = [];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function setup(){
    if(fs.existsSync(saveFilePath)){
        const save = JSON.parse(fs.readFileSync(saveFilePath));
        hosts = save.hosts;
        remotes = save.remotes;
    }
    else if(!fs.existsSync('data')){
        fs.mkdirSync('data');
        updateSave();
    }
}

function updateSave(){
    const saveData = {hosts: hosts, remotes: remotes};
    const jsonData = JSON.stringify(saveData, null, 2);
    fs.writeFileSync(saveFilePath, jsonData);
}

function hostApproved(hostId, authToken){
    const client = getClient('host', hostId);
    let approved = false;
    let message;
    if(client){
        if (client.token === authToken){
            approved = true;
        }
        else{
            message = "authTokenError";
        }
    }
    else{
        message = "hostNotExist";
    }
    let response = {approved: approved};
    if(message){
        response.message = message;
    }
    return response;
}
function remoteApproved(username, password){
    const remoteObject = remotes.find(element => element.username === username);
    if (remoteObject){
        if(password === remoteObject.password){
            return true;
        }
    }
    return false;
}
function registerRemote(registerData){
    const username = registerData.username;
    const password = registerData.password;
    if(!getClient('remote', username)){
        remotes.push({username: username, password: password, online: false, priority: 1, cloudFunctions: {}});
        updateSave();
        return {approved: true};
    }
    else{
        return {approved: false, message: "remoteAlreadyExist"};
    }
}
function registerHost(remoteUsername, hostId){
    if(!getClient('host', hostId)){
        const token = generateToken(8);
        hosts.push({hostId: hostId, token: token, owner: remoteUsername});
        updateSave();
        return {approved: true, token: token};
    }
    return {approved: false, message: "hostAlreadyExist"};
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

function generateToken(tokenLength){
    /* Generating an tokenLength characters security token with o, O or 0.*/
    const generateDigit = () => String.fromCharCode(randomInt(49, 57));
    const generateCapital = () => {
        const x = randomInt(0, 1);
        if(x === 0){
            return String.fromCharCode(randomInt(65, 78));
        }
        else{
            return String.fromCharCode(randomInt(80, 90))
        }
    };
    const generateLetter = () => {
        const x = randomInt(0, 1);
        if(x === 0){
            return String.fromCharCode(randomInt(97, 110));
        }
        else{
            return String.fromCharCode(randomInt(112, 122));
        }
    };

    let token = "";
    for(let i = 0; i < tokenLength; i++){
        const rand = randomInt(1, 3);
        switch(rand){
            case 1:
                token += generateDigit();
                break;
            case 2:
                    token += generateCapital();
                    break;
            case 3:
                token += generateLetter();
                break;
        }
    }
    return token;
}

function getClient(clientType, username){
    const finderHelper = clientType === 'host' ? 'hostId' : 'username';
    const finder = (element) => element[finderHelper] === username;
    if(clientType === 'host'){
        return hosts.find(finder);
    }
    else if(clientType === 'remote'){
        return remotes.find(finder);
    }
}

function setStatus(clientType, username, status){
    const online = status === 'online' ? true : false;
    let client = getClient(clientType, username);
    if(client){
        client.online = online;
    }
}

function setHostToken(hostId, token){
    let host = getClient('host', hostId);
    if(host){
        host.token = token;
        updateSave();
    }
}

function getHostsByOwner(owner){
    return hosts.filter((host) => host.owner === owner);
}

function changeHostToken(ownerName, hostId){
    let host = getClient('host', hostId);
    if(host && host.owner === ownerName){
        const token = generateToken(8);
        setHostToken(hostId, token);
        return {approved: true, token: token};
    }
    else{
        return {approved: false, message: "remoteNotOwner"};
    }
}

function getSocketById(socketId){
    return io.of('/').sockets.get(socketId);
}

function connectHostToRemote(remoteUsername, hostId){
    let hostSocket = getSocketById(getClient('host', hostId).socketId);
    let remoteSocket = getSocketById(getClient('remote', remoteUsername).socketId);
    let connection = connections.find(element => element.hostId === hostId);
    remoteSocket.join(hostId);
    hostSocket.join(hostId);
    if(connection){
        connection.remoteConnected = remoteUsername;
    }
    else{
        connections.push({hostId: hostId, remoteConnected: remoteUsername}); 
    }
}
function disconnectFromHost(remoteUsername, hostId){
    let remoteSocket = getSocketById(getClient('remote', remoteUsername).socketId);
    let connectionIndex = connections.findIndex(element => element.hostId === hostId);
    remoteSocket.leave(hostId);
    if(connectionIndex >= 0){
        connections.splice(connectionIndex, 1);
    }
}

function getPartner(clientType, name){
    /* A function to get the client of the target */
    const finderHelper = clientType === 'host' ? 'hostId' : 'remoteConnected';
    const reverseFinderHelper = clientType === 'remote' ? 'hostId' : 'remoteConnected';
    const clientName = connections.find(el => el[finderHelper] === name)[reverseFinderHelper];
    const clientTypeNew = clientType === 'host' ? 'remote' : 'host';
    const client = getClient(clientTypeNew, clientName);
    return client;
}

async function connectToHost (remoteUsername, hostId, securityPassword){
    let host = getClient('host', hostId);
    if(!host){
        return {approved: false, message: "hostNotExists"};
    }
    if(!host.socketId){
        return {approved: false, message: "hostOffline"};
    }
    let remoteUser = getClient('remote', remoteUsername);
    let hostSocket = getSocketById(host.socketId);
    let temp = getClient('remote', connections.find(element => element.host === hostId));
    let remoteConnected;
    if(temp){
        remoteConnected = temp.remoteConnected;
    }
    const sendConnectionRequest = async function() {
        let response;
        hostSocket.emit("connectionRequest", {pinger: remoteUsername, password: securityPassword}, (output) => {
            response = output;
        });
        while(!response){
            await sleep(eventDelay);
        }
        return response;
    }
    let output = {};
    if(!host){
        /* The host does not exist */
        output = {approved: false, message:"hostNotExist"};
    }
    else if(!host.online){
        /* The host if offline */
        output = {approved: false, message:"hostOffline"};
    }
    else if(!remoteConnected){
        /* The host is online and have no connected remote, free to send a connection request */
        const status = await sendConnectionRequest();
        output = status;
    }
    else{
        if(remoteUser.priority === -1){
            output = {approved: true, message:"adminConnected"};
        }
        else if(remoteUser.username === host.owner){
            output = {approved: true, message: "ownerConnected"};
        }
        else if(remoteUser.priority > remoteConnected.priority){
            const status = await sendConnectionRequest();
            if(status.approved){
                output = {approved: true, message: "kickedAndConnected"};
            }
            else{
                output = status;
            }
        }
    }
    if(output.approved){
        connectHostToRemote(remoteUsername, hostId);
        hostSocket.emit("remoteConnected", remoteUsername);
    }
    return output;
}

io.on("connection", (socket) => {
    console.log("User logged in.");
    let client = {clientType: '', username: ''};
    let loggedIn = false;

    const remoteAction = (callback, next) => {
        /* This function calls a callback only if the client is a remote control */
        if(loggedIn && client.clientType === 'remote'){
            next();
        } else{
            callback({approved: false, message: "noRemoteConnected"});
        }
    };

    /* Remote & Host events */
    socket.on("login", (clientType, loginData, callback) => {
        client.clientType = clientType;
        if(clientType === 'host'){
            const status = hostApproved(loginData.hostId, loginData.authToken);
            if(status.approved){
                client.username = loginData.hostId;
                loggedIn = true;
                socket.join(client.username);
                callback({approved: true});
            }
            else{
                callback({approved: false, message: status.message});
            }
        }
        else if(clientType === 'remote'){
            let approved = false;
            let message = "credentialsNoMatch";
            if(remoteApproved(loginData.username, loginData.password)){
                client.username = loginData.username;
                approved = true;
                loggedIn = true;
            }
            callback({approved: approved, message: message})
        }

        if(loggedIn){
            let clientRef = getClient(clientType, client.username);
            clientRef.socketId = socket.id;
            clientRef.online = true;
            // setStatus(clientType, client.username, 'online');
        }
    });
    socket.on("directTalk", (content) => {
        if(client.clientType === 'remote'){
            let partner = getPartner(client.clientType, client.username);
            if(partner){
                socket.to(partner.hostId).emit("directTalkMessage", content);
            }
        }
        else if(client.clientType === 'host'){
            socket.to(client.username).emit("directTalkMessage", content);
        }
        // sendDirectTalk(clientType, client.username, content);
    });

    /* Remote events only */
    socket.on("connectToHost", async function(hostId, securityPassword, callback) {
        remoteAction(callback, async function() {
            const status = await connectToHost(client.username, hostId, securityPassword);
            if(status.approved){
                socket.join(hostId);
            }
            callback(status);
        });
    });
    socket.on("disconnectFromHost", (callback) => {
        remoteAction(callback, async () => {
            const currentHostId = getPartner(client.clientType, client.username).hostId;
            await disconnectFromHost(client.username, currentHostId);
            callback({approved: true});
        });
    });
    socket.on("getAllHosts", (callback) => {
        remoteAction(callback, () => {
            const hosts = getHostsByOwner(client.username);
            callback({approved: true, hosts: hosts});
        });
    })

    socket.on("changeHostToken", (hostId, callback) => {
        remoteAction(callback, () => {
            const status = changeHostToken(client.username, hostId);
            callback(status);
        });
    });

    socket.on("registerRemote", (registerData, callback) => {
        const status = registerRemote(registerData);
        callback(status);
    });

    socket.on("registerHost", (hostId, callback) => {
        remoteAction(callback, () => {
            const status = registerHost(client.username, hostId);
            callback(status);
        });
    });

    /* Disconnection */
    socket.on("disconnect", () => {
        setStatus(client.clientType, client.username, 'offline');
        console.log("Socket disconnected.");
    });
});

setup();
httpServer.listen(PORT, () => {
    console.log("Listening on port: " + PORT)}
);