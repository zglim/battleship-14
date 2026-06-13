const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const socketIo2 = socketIo(server);

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

const BOARD_SIZE = 16;

// 游戏状态
const gameState = {
    players: {},       // socketId -> { color, ready }
    boardSize: BOARD_SIZE,
    obstacles: [],
    currentTurn: 'red',
    gamePhase: 'setup', // setup, playing, ended
    ships: {
        red: [],
        blue: []
    }
};

// 玩家连接追踪：color -> { socketId, disconnectedAt }
const colorSocketMap = {};   // color -> socketId
const disconnectedPlayers = {}; // color -> { disconnectedAt, timerId }

// 回合切换锁，防止重复切换
let turnSwitching = false;

// 断线重连超时（毫秒）
const RECONNECT_TIMEOUT = 60000;

// 船只类型定义
const SHIP_TYPES = {
    AIRCRAFT_CARRIER: { name: '航空母舰', size: 4, attackRange: 5, canCrossObstacles: true },
    BATTLESHIP: { name: '战列舰', size: 4, attackRange: 4, canCrossObstacles: false },
    DESTROYER: { name: '驱逐舰', size: 3, attackRange: 4, canCrossObstacles: false },
    MISSILE_BOAT: { name: '导弹艇', size: 2, attackRange: 4, canCrossObstacles: false },
    COMBAT_BOAT: { name: '战斗艇', size: 1, attackRange: 3, canCrossObstacles: false }
};

// 船只数量配置
const SHIP_COUNTS = {
    AIRCRAFT_CARRIER: 1,
    BATTLESHIP: 2,
    DESTROYER: 3,
    MISSILE_BOAT: 2,
    COMBAT_BOAT: 2
};

// 生成船只列表
function generateShipList(color) {
    const ships = [];

    for (const [typeKey, count] of Object.entries(SHIP_COUNTS)) {
        const shipType = SHIP_TYPES[typeKey];
        for (let i = 1; i <= count; i++) {
            ships.push({
                id: `${color}-${typeKey.toLowerCase()}-${i}`,
                type: typeKey.toLowerCase(),
                name: `${shipType.name} ${i}`,
                size: shipType.size,
                attackRange: shipType.attackRange,
                canCrossObstacles: shipType.canCrossObstacles,
                health: shipType.size,
                maxHealth: shipType.size,
                placed: false,
                ready: false,
                sunk: false,
                actionTaken: false,
                x: -1,
                y: -1,
                direction: 'horizontal'
            });
        }
    }

    return ships;
}

// 生成随机障碍物
function generateObstacles() {
    const obstacles = [];
    const obstacleCount = Math.floor(Math.random() * 12) + 5;

    for (let i = 0; i < obstacleCount; i++) {
        let x, y;
        do {
            x = Math.floor(Math.random() * (BOARD_SIZE - 8)) + 4;
            y = Math.floor(Math.random() * BOARD_SIZE);
        } while (obstacles.some(obs => obs.x === x && obs.y === y));

        obstacles.push({ x, y });
    }

    return obstacles;
}

// 初始化游戏
function initializeGame() {
    gameState.obstacles = generateObstacles();
    gameState.currentTurn = 'red';
    gameState.gamePhase = 'setup';
    gameState.ships.red = generateShipList('red');
    gameState.ships.blue = generateShipList('blue');
    turnSwitching = false;
}

// 获取某阵营当前活跃的 socketId
function getSocketForColor(color) {
    return colorSocketMap[color] || null;
}

// 检查某阵营是否已被其他活跃连接占用
function isColorOccupied(color, excludeSocketId) {
    const sid = colorSocketMap[color];
    if (!sid) return false;
    if (sid === excludeSocketId) return false;
    // 检查该 socket 是否仍然连接
    const s = socketIo2.sockets.sockets.get(sid);
    return !!s;
}

// 清理断线计时器
function clearDisconnectTimer(color) {
    if (disconnectedPlayers[color] && disconnectedPlayers[color].timerId) {
        clearTimeout(disconnectedPlayers[color].timerId);
    }
    delete disconnectedPlayers[color];
}

// Socket.io连接处理
socketIo2.on('connection', (socket) => {
    console.log('用户连接:', socket.id);

    socket.on('joinGame', (playerColor) => {
        // 验证阵营值
        if (playerColor !== 'red' && playerColor !== 'blue') {
            socket.emit('joinError', { message: '无效的阵营选择' });
            return;
        }

        // 检查阵营是否已被其他活跃连接占用
        if (isColorOccupied(playerColor, socket.id)) {
            // 但如果该阵营是断线状态，允许重连接管
            if (!disconnectedPlayers[playerColor]) {
                socket.emit('joinError', { message: `${playerColor === 'red' ? '红方' : '蓝方'}已被其他玩家占用` });
                return;
            }
        }

        // 如果该阵营之前断线，清理断线计时器
        clearDisconnectTimer(playerColor);

        // 如果此 socket 之前选了别的阵营，先清理旧映射
        for (const [c, sid] of Object.entries(colorSocketMap)) {
            if (sid === socket.id && c !== playerColor) {
                delete colorSocketMap[c];
            }
        }

        // 注册玩家
        gameState.players[socket.id] = {
            color: playerColor,
            ready: false
        };
        colorSocketMap[playerColor] = socket.id;

        // 如果游戏已结束则重置
        if (gameState.gamePhase === 'ended') {
            // 清理旧的socket-颜色映射
            for (const c of Object.keys(colorSocketMap)) {
                if (colorSocketMap[c] !== socket.id) {
                    // 另一个玩家可能还在，保留
                }
            }
            initializeGame();
        }

        socket.emit('gameState', gameState);
        socket.broadcast.emit('playerJoined', playerColor);

        // 如果游戏正在进行中且有人重连，通知所有人
        if (gameState.gamePhase === 'playing') {
            socketIo2.emit('playerReconnected', { color: playerColor });
        }
    });

    socket.on('placeShip', (data) => {
        const player = gameState.players[socket.id];
        if (!player || gameState.gamePhase !== 'setup') return;

        // 找到对应的船只
        const ship = gameState.ships[player.color].find(s => s.id === data.shipId);
        if (!ship || ship.placed) return;

        // 验证船只位置
        const validationResult = validateShipPlacement(data, player.color);
        if (validationResult.valid) {
            ship.x = data.x;
            ship.y = data.y;
            ship.direction = data.direction;
            ship.placed = true;
            ship.ready = true;

            socket.emit('shipPlaced', ship);
            socket.broadcast.emit('opponentShipPlaced', {
                color: player.color,
                shipCount: gameState.ships[player.color].filter(s => s.placed).length
            });

            socketIo2.emit('gameStateUpdate', gameState);
            checkSetupCompletion();
        } else {
            socket.emit('placeShipError', { message: validationResult.message });
        }
    });

    socket.on('shipAction', (data) => {
        const player = gameState.players[socket.id];
        if (!player) {
            socket.emit('actionResult', { success: false, message: '你尚未加入游戏', errorType: 'not_joined' });
            return;
        }
        if (gameState.gamePhase !== 'playing') {
            socket.emit('actionResult', { success: false, message: '游戏尚未开始或已结束', errorType: 'wrong_phase' });
            return;
        }
        if (gameState.currentTurn !== player.color) {
            socket.emit('actionResult', { success: false, message: '当前不是你的回合', errorType: 'not_your_turn' });
            return;
        }

        const result = processShipAction(data, player.color);

        if (result.success) {
            socketIo2.emit('gameStateUpdate', gameState);

            socket.emit('actionResult', Object.assign({
                success: true,
                animation: data.type,
                shipId: data.shipId
            }, result));

            maybeAutoEndTurn(player.color);
        } else {
            socket.emit('actionResult', {
                success: false,
                message: result.message,
                errorType: result.errorType || 'action_failed'
            });
        }
    });

    socket.on('endTurn', (currentPlayer) => {
        const player = gameState.players[socket.id];
        if (!player || gameState.gamePhase !== 'playing' || gameState.currentTurn !== player.color) return;
        if (player.color !== currentPlayer) return;

        // 防止重复切换
        if (turnSwitching) return;
        turnSwitching = true;

        switchTurn();

        turnSwitching = false;
    });

    socket.on('disconnect', () => {
        console.log('用户断开连接:', socket.id);
        const player = gameState.players[socket.id];

        if (player) {
            const color = player.color;
            delete gameState.players[socket.id];
            delete colorSocketMap[color];

            // 如果游戏正在进行，启动断线重连计时
            if (gameState.gamePhase === 'playing') {
                socketIo2.emit('playerDisconnected', { color: color });

                const timerId = setTimeout(() => {
                    // 超时：判定断线玩家弃权
                    delete disconnectedPlayers[color];
                    const winner = color === 'red' ? 'blue' : 'red';
                    console.log(`${color} 方断线超时，${winner} 方获胜`);
                    gameState.gamePhase = 'ended';
                    socketIo2.emit('gameEnded', { winner: winner, loser: color, reason: 'disconnect_timeout' });
                }, RECONNECT_TIMEOUT);

                disconnectedPlayers[color] = {
                    disconnectedAt: Date.now(),
                    timerId: timerId
                };
            } else if (gameState.gamePhase === 'setup') {
                // 设置阶段断线：直接重置该玩家的船只
                gameState.ships[color].forEach(ship => {
                    ship.placed = false;
                    ship.ready = false;
                    ship.x = -1;
                    ship.y = -1;
                });
                socketIo2.emit('gameStateUpdate', gameState);
            }
        }
    });
});

// 切换回合（统一入口）
function switchTurn() {
    const prevTurn = gameState.currentTurn;
    gameState.currentTurn = gameState.currentTurn === 'red' ? 'blue' : 'red';
    resetShipActions(gameState.currentTurn);
    socketIo2.emit('turnChanged', gameState.currentTurn);
    socketIo2.emit('gameStateUpdate', gameState);
    console.log(`回合切换: ${prevTurn} -> ${gameState.currentTurn}`);
}

// 验证船只放置位置
function validateShipPlacement(data, color) {
    const ship = gameState.ships[color].find(s => s.id === data.shipId);
    if (!ship) return { valid: false, message: '未找到对应船只' };

    // size>2的船只不能放在棋盘边缘
    if (ship.size > 2) {
        if (data.direction === 'horizontal') {
            if (data.y === 0 || data.y === BOARD_SIZE - 1) {
                return { valid: false, message: '大型船只不能放在棋盘边缘' };
            }
        } else {
            if (data.x === 0 || data.x === BOARD_SIZE - 1) {
                return { valid: false, message: '大型船只不能放在棋盘边缘' };
            }
        }
    }

    // 检查每格
    for (let i = 0; i < ship.size; i++) {
        const checkX = data.direction === 'horizontal' ? data.x + i : data.x;
        const checkY = data.direction === 'vertical' ? data.y + i : data.y;

        // 检查是否在正确的一侧（红方左侧，蓝方右侧）
        const validX = color === 'red' ? checkX < 8 : checkX >= 8;
        if (!validX) return { valid: false, message: `船只必须放在${color === 'red' ? '左' : '右'}侧区域` };

        // 检查边界
        if (checkX < 0 || checkX >= BOARD_SIZE || checkY < 0 || checkY >= BOARD_SIZE) {
            return { valid: false, message: '船只位置超出棋盘边界' };
        }

        // 检查障碍物
        if (gameState.obstacles.some(obs => obs.x === checkX && obs.y === checkY)) {
            return { valid: false, message: '船只位置与障碍物重叠' };
        }

        // 检查其他船只
        if (gameState.ships[color].some(existingShip => {
            if (!existingShip.placed || existingShip.id === ship.id) return false;
            for (let j = 0; j < existingShip.size; j++) {
                const existingX = existingShip.direction === 'horizontal' ? existingShip.x + j : existingShip.x;
                const existingY = existingShip.direction === 'vertical' ? existingShip.y + j : existingShip.y;
                if (existingX === checkX && existingY === checkY) return true;
            }
            return false;
        })) {
            return { valid: false, message: '船只位置与其他船只重叠' };
        }
    }

    return { valid: true };
}

// 检查设置阶段是否完成
function checkSetupCompletion() {
    const redShipsPlaced = gameState.ships.red.filter(s => s.placed).length;
    const blueShipsPlaced = gameState.ships.blue.filter(s => s.placed).length;

    const totalShips = Object.values(SHIP_COUNTS).reduce((a, b) => a + b, 0);

    const redPlayerConnected = Object.values(colorSocketMap).some(sid => {
        const s = socketIo2.sockets.sockets.get(sid);
        return s && gameState.players[sid] && gameState.players[sid].color === 'red';
    });
    const bluePlayerConnected = Object.values(colorSocketMap).some(sid => {
        const s = socketIo2.sockets.sockets.get(sid);
        return s && gameState.players[sid] && gameState.players[sid].color === 'blue';
    });

    if (redShipsPlaced === totalShips && blueShipsPlaced === totalShips &&
        redPlayerConnected && bluePlayerConnected) {
        gameState.gamePhase = 'playing';
        socketIo2.emit('gameStarted', gameState);
    }
}

// 处理船只动作
function processShipAction(action, color) {
    const ship = gameState.ships[color].find(s => s.id === action.shipId);
    if (!ship) {
        return { success: false, message: '未找到对应船只', errorType: 'ship_not_found' };
    }
    if (ship.sunk) {
        return { success: false, message: '该船只已被击沉', errorType: 'ship_sunk' };
    }
    if (ship.actionTaken) {
        return { success: false, message: '该船只本回合已行动过', errorType: 'already_acted' };
    }
    if (!ship.placed) {
        return { success: false, message: '该船只尚未放置', errorType: 'ship_not_placed' };
    }

    switch (action.type) {
        case 'move':
            return moveShip(ship, action, color);
        case 'attack':
            return attackWithShip(ship, action, color);
        case 'rotate':
            return rotateShip(ship, action, color);
        default:
            return { success: false, message: '未知的动作类型', errorType: 'unknown_action' };
    }
}

// 攻击逻辑
function attackWithShip(ship, action, color) {
    const attackValidation = validateAttackPosition(ship, action.targetX, action.targetY, color);
    if (!attackValidation.valid) {
        return { success: false, message: attackValidation.message, errorType: attackValidation.errorType };
    }

    // 掷骰子决定攻击力
    const diceRoll = Math.floor(Math.random() * 6) + 1;
    let attackPower = 0;

    if (diceRoll === 1) attackPower = 1;
    else if (diceRoll === 2) attackPower = 2;
    else if (diceRoll === 6) attackPower = ship.size;
    else attackPower = 0;

    if (attackPower > 0) {
        const targetColor = color === 'red' ? 'blue' : 'red';
        const targetShips = gameState.ships[targetColor];

        for (const targetShip of targetShips) {
            if (!targetShip.placed || targetShip.sunk) continue;

            for (let i = 0; i < targetShip.size; i++) {
                const targetX = targetShip.direction === 'horizontal' ? targetShip.x + i : targetShip.x;
                const targetY = targetShip.direction === 'vertical' ? targetShip.y + i : targetShip.y;

                if (targetX === action.targetX && targetY === action.targetY) {
                    targetShip.health = Math.max(0, targetShip.health - attackPower);

                    if (targetShip.health <= 0) {
                        targetShip.sunk = true;
                        console.log(`船只 ${targetShip.id} 被击沉！`);
                    } else {
                        console.log(`船只 ${targetShip.id} 受到 ${attackPower} 点伤害，剩余生命值: ${targetShip.health}`);
                    }
                    break;
                }
            }
        }
    }

    ship.actionTaken = true;

    socketIo2.emit('attackResult', {
        success: true,
        targetX: action.targetX,
        targetY: action.targetY,
        attackPower: attackPower
    });

    return {
        success: true,
        message: `攻击！骰子点数: ${diceRoll}, ${attackPower > 0 ? `伤害: ${attackPower}` : '没打中！'}`,
        attackPower,
        diceRoll,
        x: action.targetX,
        y: action.targetY
    };
}

// 验证攻击位置（返回详细错误）
function validateAttackPosition(ship, targetX, targetY, color) {
    // 检查边界
    if (targetX < 0 || targetX >= BOARD_SIZE || targetY < 0 || targetY >= BOARD_SIZE) {
        return { valid: false, message: '攻击位置超出棋盘边界', errorType: 'out_of_bounds' };
    }

    // 必须攻击到敌方船只的某一格
    const opponentShips = gameState.ships[color === 'red' ? 'blue' : 'red'];
    let targetIsEnemyCell = false;
    for (const otherShip of opponentShips) {
        if (!otherShip.placed || otherShip.sunk) continue;
        for (let i = 0; i < otherShip.size; i++) {
            const otherX = otherShip.direction === 'horizontal' ? otherShip.x + i : otherShip.x;
            const otherY = otherShip.direction === 'vertical' ? otherShip.y + i : otherShip.y;
            if (otherX === targetX && otherY === targetY) {
                targetIsEnemyCell = true;
                break;
            }
        }
        if (targetIsEnemyCell) break;
    }
    if (!targetIsEnemyCell) {
        return { valid: false, message: '目标位置没有敌方船只', errorType: 'no_enemy_at_target' };
    }

    // 计算攻击范围
    const attackerCells = [];
    for (let i = 0; i < ship.size; i++) {
        const ax = ship.direction === 'horizontal' ? ship.x + i : ship.x;
        const ay = ship.direction === 'vertical' ? ship.y + i : ship.y;
        attackerCells.push({ x: ax, y: ay });
    }

    const range = ship.attackRange || 0;
    for (const a of attackerCells) {
        if (a.y === targetY && Math.abs(a.x - targetX) <= range) return { valid: true };
        if (a.x === targetX && Math.abs(a.y - targetY) <= range) return { valid: true };
    }

    return { valid: false, message: '目标超出攻击范围（需同行或同列且距离不超过' + range + '格）', errorType: 'out_of_attack_range' };
}

// 转向船只
function rotateShip(ship, action, color) {
    // 单格船只不允许转向
    if (ship.size === 1) {
        return { success: false, message: '单格船只无法转向', errorType: 'cannot_rotate' };
    }

    let newDirection = ship.direction === 'horizontal' ? 'vertical' : 'horizontal';

    // 验证转向后的位置是否合法
    const posCheck = checkPositionValidity(ship.id, newDirection, ship.size, action.targetX, action.targetY);
    if (!posCheck.valid) {
        return { success: false, message: `转向后位置无效：${posCheck.reason}`, errorType: 'invalid_rotate_position' };
    }

    ship.x = action.targetX;
    ship.y = action.targetY;
    ship.direction = newDirection;
    ship.actionTaken = true;
    return { success: true, message: '转向成功' };
}

// 移动船只
function moveShip(ship, action, color) {
    const targetX = action.targetX;
    const targetY = action.targetY;

    // 检查是否与当前位置相同
    if (targetX === ship.x && targetY === ship.y) {
        return { success: false, message: '目标位置与当前位置相同', errorType: 'same_position' };
    }

    // 统一移动规则验证
    const moveValidation = validateMovementRules(ship, targetX, targetY);
    if (!moveValidation.valid) {
        return { success: false, message: moveValidation.message, errorType: moveValidation.errorType };
    }

    // 验证目标位置是否合法（边界、障碍、重叠）
    const posCheck = checkPositionValidity(ship.id, ship.direction, ship.size, targetX, targetY);
    if (!posCheck.valid) {
        return { success: false, message: posCheck.reason, errorType: posCheck.errorType };
    }

    ship.x = targetX;
    ship.y = targetY;
    ship.actionTaken = true;

    console.log(`船只 ${ship.id} 移动到位置 (${targetX}, ${targetY})`);
    return { success: true, message: '移动成功' };
}

// ========== 统一移动规则验证（前后端共用逻辑） ==========
function validateMovementRules(ship, targetX, targetY) {
    const dx = targetX - ship.x;
    const dy = targetY - ship.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (ship.size === 1) {
        // 单格船只：只能向上下左右移动恰好一格
        if (!((adx === 1 && ady === 0) || (adx === 0 && ady === 1))) {
            return { valid: false, message: '单格船只只能向上/下/左/右移动一格', errorType: 'invalid_move_direction' };
        }
    } else {
        // 多格船只：只能沿朝向移动一格
        if (ship.direction === 'horizontal') {
            if (dy !== 0) {
                return { valid: false, message: '水平方向的船只只能水平移动', errorType: 'invalid_move_direction' };
            }
            if (adx !== 1) {
                return { valid: false, message: '船只每次只能移动一格', errorType: 'invalid_move_distance' };
            }
        } else {
            if (dx !== 0) {
                return { valid: false, message: '垂直方向的船只只能垂直移动', errorType: 'invalid_move_direction' };
            }
            if (ady !== 1) {
                return { valid: false, message: '船只每次只能移动一格', errorType: 'invalid_move_distance' };
            }
        }
    }

    return { valid: true };
}

// ========== 通用位置合法性检查 ==========
function checkPositionValidity(shipId, direction, size, targetX, targetY) {
    for (let i = 0; i < size; i++) {
        let checkX, checkY;

        if (direction === 'horizontal') {
            checkX = targetX + i;
            checkY = targetY;
        } else {
            checkX = targetX;
            checkY = targetY + i;
        }

        if (checkX < 0 || checkX >= BOARD_SIZE || checkY < 0 || checkY >= BOARD_SIZE) {
            return { valid: false, reason: '位置超出棋盘边界', errorType: 'out_of_bounds' };
        }

        if (gameState.obstacles.some(obs => obs.x === checkX && obs.y === checkY)) {
            return { valid: false, reason: '位置与障碍物重叠', errorType: 'obstacle_overlap' };
        }

        // 检查是否与其他船只重叠
        const allShips = gameState.ships.red.concat(gameState.ships.blue);
        for (const otherShip of allShips) {
            if (otherShip.id === shipId || !otherShip.placed || otherShip.sunk) continue;

            for (let j = 0; j < otherShip.size; j++) {
                const otherX = otherShip.direction === 'horizontal' ? otherShip.x + j : otherShip.x;
                const otherY = otherShip.direction === 'vertical' ? otherShip.y + j : otherShip.y;

                if (otherX === checkX && otherY === checkY) {
                    return { valid: false, reason: `位置与船只${otherShip.name}重叠`, errorType: 'ship_overlap' };
                }
            }
        }
    }
    return { valid: true };
}

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Battleship游戏服务器运行在端口 ${PORT}`);
    initializeGame();
});

// 重置船只行动状态
function resetShipActions(color) {
    gameState.ships[color].forEach(ship => {
        ship.actionTaken = false;
    });
    console.log(`重置 ${color} 方所有船只的行动状态`);
}

// 检查指定颜色是否还有可行动的船只
function hasAvailableActions(color) {
    return gameState.ships[color].some(ship => ship.placed && !ship.sunk && !ship.actionTaken);
}

// 如果当前玩家没有可行动的船只，则自动结束回合
function maybeAutoEndTurn(color) {
    if (gameState.gamePhase !== 'playing') return;
    if (gameState.currentTurn !== color) return;
    if (turnSwitching) return;

    // 检查是否一方全部被击沉
    const redAllSunk = gameState.ships.red.filter(s => s.placed).length > 0 &&
                       gameState.ships.red.every(s => s.sunk === true);
    const blueAllSunk = gameState.ships.blue.filter(s => s.placed).length > 0 &&
                        gameState.ships.blue.every(s => s.sunk === true);

    if (redAllSunk || blueAllSunk) {
        turnSwitching = true;
        setTimeout(() => {
            gameState.gamePhase = 'ended';
            const winner = redAllSunk ? 'blue' : 'red';
            const loser = winner === 'red' ? 'blue' : 'red';
            console.log(`游戏结束！${winner} 方获胜！`);
            socketIo2.emit('gameEnded', { winner: winner, loser: loser });
            turnSwitching = false;
        }, 2200);
    } else if (!hasAvailableActions(color)) {
        console.log(`${color} 方没有可行动的船只，自动结束回合`);
        turnSwitching = true;
        setTimeout(() => {
            if (gameState.gamePhase !== 'playing' || gameState.currentTurn !== color) {
                turnSwitching = false;
                return;
            }
            switchTurn();
            turnSwitching = false;
        }, 2200);
    }
}

// ========== 导出接口供测试使用 ==========
if (typeof module !== 'undefined') {
    module.exports = {
        validateMovementRules,
        checkPositionValidity,
        validateAttackPosition,
        validateShipPlacement,
        processShipAction,
        switchTurn,
        gameState,
        SHIP_TYPES,
        SHIP_COUNTS,
        BOARD_SIZE,
        resetShipActions,
        hasAvailableActions,
        initializeGame
    };
}
