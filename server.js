const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 游戏状态
const gameState = {
    players: {},
    boardSize: 16,
    obstacles: [],
    currentTurn: 'red',
    gamePhase: 'setup', // setup, playing, ended
    ships: {
        red: [],
        blue: []
    },
    battleLog: [],    // 战报日志，按时间顺序
    turnCount: 1,     // 当前回合数（红蓝各行动一次算一回合）
    lastBlow: null    // 最后一击信息（用于结算面板）
};

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

// 颜色中文名映射
const COLOR_NAME = { red: '红方', blue: '蓝方' };

// 生成船只列表
function generateShipList(color) {
    const ships = [];
    let shipId = 1;

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
            shipId++;
        }
    }

    return ships;
}

// 生成随机障碍物
function generateObstacles() {
    const obstacles = [];
    const obstacleCount = Math.floor(Math.random() * 12) + 5; // 5-16个障碍

    for (let i = 0; i < obstacleCount; i++) {
        let x, y;
        do {
            x = Math.floor(Math.random() * (gameState.boardSize - 8)) + 4;
            y = Math.floor(Math.random() * gameState.boardSize);
        } while (obstacles.some(obs => obs.x === x && obs.y === y));

        obstacles.push({ x, y });
    }

    return obstacles;
}

// 添加战报条目（去重 + 广播）
function addBattleLog(entry) {
    const logEntry = Object.assign({
        timestamp: Date.now(),
        turn: gameState.turnCount,
        phase: gameState.gamePhase
    }, entry);
    gameState.battleLog.push(logEntry);
    io.emit('battleLogUpdate', gameState.battleLog);
    return logEntry;
}

// 初始化游戏
function initializeGame() {
    gameState.obstacles = generateObstacles();
    gameState.currentTurn = 'red';
    gameState.gamePhase = 'setup';
    gameState.ships.red = generateShipList('red');
    gameState.ships.blue = generateShipList('blue');
    gameState.battleLog = [];
    gameState.turnCount = 1;
    gameState.lastBlow = null;
}

// Socket.io连接处理
io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);

    socket.on('joinGame', (playerColor) => {
        gameState.players[socket.id] = {
            color: playerColor,
            ready: false
        };
        // 如果gameState.gamePhase是ended则重置游戏
        if (gameState.gamePhase === 'ended') {
            initializeGame();
        }
        socket.emit('gameState', gameState);
        socket.broadcast.emit('playerJoined', playerColor);
    });

    socket.on('placeShip', (data) => {
        const player = gameState.players[socket.id];
        if (!player || gameState.gamePhase !== 'setup') return;

        // 找到对应的船只
        const ship = gameState.ships[player.color].find(s => s.id === data.shipId);
        if (!ship || ship.placed) return;

        // 验证船只位置
        if (isValidShipPlacement(data, player.color)) {
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

            // 记录战报：船只放置
            addBattleLog({
                type: 'place',
                color: player.color,
                colorName: COLOR_NAME[player.color],
                shipId: ship.id,
                shipName: ship.name,
                x: ship.x,
                y: ship.y,
                direction: ship.direction,
                message: `${COLOR_NAME[player.color]} 放置了 ${ship.name} 于 (${ship.x},${ship.y})`
            });

            // 向所有客户端发送完整的游戏状态更新
            io.emit('gameStateUpdate', gameState);

            // 检查是否所有船只都已放置
            checkSetupCompletion();
        }
    });

    // 在shipAction事件处理中添加船只状态更新
    socket.on('shipAction', (data) => {
        const player = gameState.players[socket.id];
        if (!player || gameState.gamePhase !== 'playing' || gameState.currentTurn !== player.color) {
            socket.emit('actionResult', {
                success: false,
                message: '当前无法执行动作'
            });
            return;
        }

        const result = processShipAction(data, player.color);

        if (result.success) {
            // 广播更新后的游戏状态
            io.emit('gameStateUpdate', gameState);

            // 发送动作结果（包含动画信息和可能的攻击细节）
            socket.emit('actionResult', Object.assign({
                success: true,
                animation: data.type, // 添加动画类型信息
                shipId: data.shipId
            }, result));
            // 动作完成后检查当前玩家是否还有可行动的船只，若没有则自动结束回合
            maybeAutoEndTurn(player.color);
        } else {
            socket.emit('actionResult', {
                success: false,
                message: result.message
            });
        }
    });

    // 添加回合结束事件处理
    socket.on('endTurn', (currentPlayer) => {
        const player = gameState.players[socket.id];
        if (!player || gameState.gamePhase !== 'playing' || gameState.currentTurn !== player.color) return;
        // 如果不是当前回合玩家，直接返回
        if (player.color !== currentPlayer) return;

        // 记录战报：手动结束回合
        addBattleLog({
            type: 'endTurn',
            color: gameState.currentTurn,
            colorName: COLOR_NAME[gameState.currentTurn],
            turn: gameState.turnCount,
            manual: true,
            message: `${COLOR_NAME[gameState.currentTurn]} 手动结束回合（第 ${gameState.turnCount} 回合）`
        });

        // 切换回合
        gameState.currentTurn = gameState.currentTurn === 'red' ? 'blue' : 'red';
        // 每完成一轮（蓝方回合结束）增加回合计数
        if (gameState.currentTurn === 'red') {
            gameState.turnCount++;
        }
        // 重置当前玩家所有船只的行动状态
        resetShipActions(gameState.currentTurn);

        addBattleLog({
            type: 'turnStart',
            color: gameState.currentTurn,
            colorName: COLOR_NAME[gameState.currentTurn],
            turn: gameState.turnCount,
            message: `第 ${gameState.turnCount} 回合开始，${COLOR_NAME[gameState.currentTurn]} 行动`
        });

        io.emit('turnChanged', gameState.currentTurn);
        io.emit('gameStateUpdate', gameState);
    });

    socket.on('disconnect', () => {
        console.log('用户断开连接:', socket.id);
        delete gameState.players[socket.id];
    });
});

// 验证船只放置位置
function isValidShipPlacement(data, color) {
    const ship = gameState.ships[color].find(s => s.id === data.shipId);
    if (!ship) return false;

    //size>2的船只不能放在棋盘边缘
    if (ship.size > 2) {
        if (ship.direction === 'horizontal') {
            if (data.y === 0 || data.y === gameState.boardSize - 1) return false;
        }else {
            if (data.x === 0 || data.x === gameState.boardSize - 1) return false;
        }
    }

    // 检查是否与障碍物或其他船只重叠
    for (let i = 0; i < ship.size; i++) {
        const checkX = data.direction === 'horizontal' ? data.x + i : data.x;
        const checkY = data.direction === 'vertical' ? data.y + i : data.y;

        // 检查是否在正确的一侧（红方左侧，蓝方右侧）
        const validX = color === 'red' ? checkX < 8 : checkX >= 8;
        if (!validX) return false;

        // 检查边界
        if (checkX >= gameState.boardSize || checkY >= gameState.boardSize) return false;

        // 检查障碍物
        if (gameState.obstacles.some(obs => obs.x === checkX && obs.y === checkY)) return false;

        // 检查其他船只
        if (gameState.ships[color].some(existingShip => {
            if (!existingShip.placed || existingShip.id === ship.id) return false;
            for (let j = 0; j < existingShip.size; j++) {
                const existingX = existingShip.direction === 'horizontal' ? existingShip.x + j : existingShip.x;
                const existingY = existingShip.direction === 'vertical' ? existingShip.y + j : existingShip.y;
                if (existingX === checkX && existingY === checkY) return true;
            }
            return false;
        })) return false;
    }

    return true;
}

// 检查设置阶段是否完成
function checkSetupCompletion() {
    const redShipsPlaced = gameState.ships.red.filter(s => s.placed).length;
    const blueShipsPlaced = gameState.ships.blue.filter(s => s.placed).length;

    const totalShips = Object.values(SHIP_COUNTS).reduce((a, b) => a + b, 0);

    // 当某方全部放置完成时记录战报
    if (redShipsPlaced === totalShips) {
        const alreadyLogged = gameState.battleLog.some(
            e => e.type === 'setupComplete' && e.color === 'red'
        );
        if (!alreadyLogged) {
            addBattleLog({
                type: 'setupComplete',
                color: 'red',
                colorName: '红方',
                message: '红方 全部船只放置完成！'
            });
        }
    }
    if (blueShipsPlaced === totalShips) {
        const alreadyLogged = gameState.battleLog.some(
            e => e.type === 'setupComplete' && e.color === 'blue'
        );
        if (!alreadyLogged) {
            addBattleLog({
                type: 'setupComplete',
                color: 'blue',
                colorName: '蓝方',
                message: '蓝方 全部船只放置完成！'
            });
        }
    }

    // 检查玩家连接状态
    const redPlayerConnected = Object.values(gameState.players).some(p => p.color === 'red');
    const bluePlayerConnected = Object.values(gameState.players).some(p => p.color === 'blue');

    if (redShipsPlaced === totalShips && blueShipsPlaced === totalShips &&
        redPlayerConnected && bluePlayerConnected) {
        gameState.gamePhase = 'playing';
        addBattleLog({
            type: 'gameStart',
            turn: 1,
            message: '战斗开始！红方先手行动'
        });
        io.emit('gameStarted', gameState);
    }
}

// 处理船只动作
function processShipAction(action, color) {
    const ship = gameState.ships[color].find(s => s.id === action.shipId);
    if (!ship || ship.actionTaken) {
        return { success: false, message: '船只无法行动' };
    }

    let result;
    switch (action.type) {
        case 'move':
            result = moveShip(ship, action, color);
            break;
        case 'attack':
            result = attackWithShip(ship, action, color);
            break;
        case 'rotate':
            result = rotateShip(ship, action, color);
            break;
        default:
            result = { success: false, message: '未知的动作类型' };
    }

    // 移除这里的广播，由事件处理函数统一处理
    return result;
}

// 攻击逻辑
function attackWithShip(ship, action, color) {
    // 验证攻击位置
    console.log(`船只 ${ship.id} 试图攻击位置 (${action.targetX}, ${action.targetY})`);
    if (!isValidAttackPosition(ship, action.targetX, action.targetY, color)) {
        return { success: false, message: '无效的攻击位置' };
    }

    // 掷骰子决定攻击力
    const diceRoll = Math.floor(Math.random() * 6) + 1;
    let attackPower = 0;

    if (diceRoll === 1) attackPower = 1;
    else if (diceRoll === 2) attackPower = 2;
    else if (diceRoll === 6) attackPower = ship.size; // 6点为满伤害
    else attackPower = 0; // 3-5点没有攻击力

    // 查找目标船只（即使没有伤害也要识别目标）
    const targetColor = color === 'red' ? 'blue' : 'red';
    const targetShips = gameState.ships[targetColor];
    let targetShipName = null;
    let targetShipId = null;
    let sunk = false;
    let damageDealt = 0;
    let targetHpBefore = 0;
    let targetHpAfter = 0;

    if (attackPower > 0) {
        for (const targetShip of targetShips) {
            if (!targetShip.placed || targetShip.sunk) continue;

            for (let i = 0; i < targetShip.size; i++) {
                const targetX = targetShip.direction === 'horizontal' ? targetShip.x + i : targetShip.x;
                const targetY = targetShip.direction === 'vertical' ? targetShip.y + i : targetShip.y;

                if (targetX === action.targetX && targetY === action.targetY) {
                    targetShipName = targetShip.name;
                    targetShipId = targetShip.id;
                    targetHpBefore = targetShip.health;
                    // 造成伤害
                    targetShip.health = Math.max(0, targetShip.health - attackPower);
                    targetHpAfter = targetShip.health;
                    damageDealt = attackPower;

                    if (targetShip.health <= 0) {
                        targetShip.sunk = true;
                        sunk = true;
                        console.log(`船只 ${targetShip.id} 被击沉！`);
                    } else {
                        console.log(`船只 ${targetShip.id} 受到 ${attackPower} 点伤害，剩余生命值: ${targetShip.health}`);
                    }

                    break;
                }
            }
        }
    } else {
        // 没打出伤害，但也识别一下被攻击格子所属的船只（用于战报）
        for (const targetShip of targetShips) {
            if (!targetShip.placed || targetShip.sunk) continue;
            for (let i = 0; i < targetShip.size; i++) {
                const tX = targetShip.direction === 'horizontal' ? targetShip.x + i : targetShip.x;
                const tY = targetShip.direction === 'vertical' ? targetShip.y + i : targetShip.y;
                if (tX === action.targetX && tY === action.targetY) {
                    targetShipName = targetShip.name;
                    targetShipId = targetShip.id;
                    targetHpBefore = targetShip.health;
                    targetHpAfter = targetShip.health;
                    break;
                }
            }
            if (targetShipName) break;
        }
    }

    ship.actionTaken = true;

    // 记录最后一击信息
    gameState.lastBlow = {
        attackerColor: color,
        attackerColorName: COLOR_NAME[color],
        attackerShipName: ship.name,
        attackerShipId: ship.id,
        targetColor: targetColor,
        targetColorName: COLOR_NAME[targetColor],
        targetShipName: targetShipName,
        targetShipId: targetShipId,
        targetX: action.targetX,
        targetY: action.targetY,
        diceRoll: diceRoll,
        attackPower: attackPower,
        damageDealt: damageDealt,
        sunk: sunk,
        turn: gameState.turnCount,
        timestamp: Date.now()
    };

    // 战报：攻击
    const attackMsg = attackPower > 0
        ? `${COLOR_NAME[color]} ${ship.name} 攻击 (${action.targetX},${action.targetY})，掷骰 ${diceRoll}，对 ${targetShipName || '目标'} 造成 ${attackPower} 点伤害${sunk ? '，击沉！' : `（目标剩余 HP ${targetHpAfter}）`}`
        : `${COLOR_NAME[color]} ${ship.name} 攻击 (${action.targetX},${action.targetY})，掷骰 ${diceRoll}，未命中（目标: ${targetShipName || '未知'}）`;

    addBattleLog({
        type: 'attack',
        color: color,
        colorName: COLOR_NAME[color],
        shipId: ship.id,
        shipName: ship.name,
        targetX: action.targetX,
        targetY: action.targetY,
        diceRoll: diceRoll,
        attackPower: attackPower,
        damageDealt: damageDealt,
        targetShipId: targetShipId,
        targetShipName: targetShipName,
        targetColor: targetColor,
        targetColorName: COLOR_NAME[targetColor],
        targetHpBefore: targetHpBefore,
        targetHpAfter: targetHpAfter,
        sunk: sunk,
        message: attackMsg
    });

    // 如果击沉了船只，额外添加一条击沉战报
    if (sunk) {
        addBattleLog({
            type: 'sunk',
            color: color,
            colorName: COLOR_NAME[color],
            targetColor: targetColor,
            targetColorName: COLOR_NAME[targetColor],
            shipId: targetShipId,
            shipName: targetShipName,
            message: `${COLOR_NAME[targetColor]} 的 ${targetShipName} 被击沉！`
        });
    }

    io.emit('attackResult', {
        success: true,
        targetX: action.targetX,
        targetY: action.targetY,
        attackPower: attackPower,
        diceRoll: diceRoll,
        damageDealt: damageDealt,
        targetShipName: targetShipName,
        sunk: sunk
    });

    return {
        success: true,
        message: `攻击！骰子点数: ${diceRoll}, ${attackPower > 0 ? `伤害: ${attackPower}` : '没打中！'}` ,
        attackPower,
        diceRoll,
        damageDealt,
        targetShipName,
        targetShipId,
        sunk,
        x: action.targetX,
        y: action.targetY
    };
}

// 转向船只
function rotateShip(ship, action, color) {
    let newDirection = ship.direction === 'horizontal' ? 'vertical' : 'horizontal';
    // 验证转向后的位置是否合法
    if (!canShipMoveTo(ship.id, newDirection, ship.size, action.targetX, action.targetY)) {
        return { success: false, message: '转向后位置无效' };
    }
    const oldX = ship.x;
    const oldY = ship.y;
    const oldDir = ship.direction;
    // 同时船移动到新的位置
    ship.x = action.targetX;
    ship.y = action.targetY;
    ship.direction = newDirection;
    ship.actionTaken = true;

    addBattleLog({
        type: 'rotate',
        color: color,
        colorName: COLOR_NAME[color],
        shipId: ship.id,
        shipName: ship.name,
        fromX: oldX,
        fromY: oldY,
        fromDirection: oldDir,
        toX: ship.x,
        toY: ship.y,
        toDirection: newDirection,
        message: `${COLOR_NAME[color]} ${ship.name} 转向 (${oldX},${oldY}) ${oldDir === 'horizontal' ? '水平' : '垂直'} → (${ship.x},${ship.y}) ${newDirection === 'horizontal' ? '水平' : '垂直'}`
    });

    return { success: true, message: '转向成功' };
}

// 移动船只
function moveShip(ship, action, color) {
    // 检查是否与当前位置相同
    if (action.targetX === ship.x && action.targetY === ship.y) {
        return { success: false, message: '无效的移动位置' };
    }

    // 验证移动位置
    if (!canShipMoveTo(ship.id, ship.direction, ship.size, action.targetX, action.targetY)) {
        return { success: false, message: '无效的移动位置' };
    }

    const oldX = ship.x;
    const oldY = ship.y;
    // 更新船只位置
    ship.x = action.targetX;
    ship.y = action.targetY;
    ship.actionTaken = true;

    console.log(`船只 ${ship.id} 移动到位置 (${action.targetX}, ${action.targetY})`);

    addBattleLog({
        type: 'move',
        color: color,
        colorName: COLOR_NAME[color],
        shipId: ship.id,
        shipName: ship.name,
        fromX: oldX,
        fromY: oldY,
        toX: ship.x,
        toY: ship.y,
        message: `${COLOR_NAME[color]} ${ship.name} 移动 (${oldX},${oldY}) → (${ship.x},${ship.y})`
    });

    return { success: true, message: '移动成功' };
}

function canShipMoveTo(shipid, direction, size, targetX, targetY) {
    console.log(`验证船只 ${shipid} 移动到 (${targetX}, ${targetY})，方向: ${direction}, 大小: ${size}`);
    for (let i = 0; i < size; i++) {
        let checkX, checkY;

        if (direction === 'horizontal') {
            checkX = targetX + i;
            checkY = targetY;
        } else {
            checkX = targetX;
            checkY = targetY + i;
        }

        // 检查是否超出棋盘边界
        if (checkX < 0 || checkX >= gameState.boardSize || checkY < 0 || checkY >= gameState.boardSize) {
            console.log('移动位置超出边界');
            return false;
        }

        // 检查是否与障碍物重叠
        if (gameState.obstacles.some(obs => obs.x === checkX && obs.y === checkY)) {
            console.log('移动位置与障碍物重叠');
            return false;
        }

        // 检查是否与其他船只重叠（排除自己）
        const playerShips = gameState.ships.red.concat(gameState.ships.blue);
        for (const otherShip of playerShips) {
            if (otherShip.id === shipid || !otherShip.placed || otherShip.sunk ) continue;

            for (let j = 0; j < otherShip.size; j++) {
                const otherX = otherShip.direction === 'horizontal' ? otherShip.x + j : otherShip.x;
                const otherY = otherShip.direction === 'vertical' ? otherShip.y + j : otherShip.y;

                if (otherX === checkX && otherY === checkY) {
                    console.log('移动位置与其他船只重叠');
                    return false;
                }
            }
        }
    }
    return true;
}

// 验证攻击位置
function isValidAttackPosition(ship, targetX, targetY, color) {
    // 检查是否在棋盘范围内
    if (targetX < 0 || targetX >= gameState.boardSize || targetY < 0 || targetY >= gameState.boardSize) {
        console.log('攻击位置超出边界');
        return false;
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
        console.log('攻击位置没有敌方船只');
        return false;
    }

    // 计算攻击方所有格子，检查是否存在一对格子在同一行或同一列且间距不超过attackRange
    const attackerCells = [];
    for (let i = 0; i < ship.size; i++) {
        const ax = ship.direction === 'horizontal' ? ship.x + i : ship.x;
        const ay = ship.direction === 'vertical' ? ship.y + i : ship.y;
        attackerCells.push({ x: ax, y: ay });
    }

    const range = ship.attackRange || 0;
    for (const a of attackerCells) {
        // 同一行
        if (a.y === targetY && Math.abs(a.x - targetX) <= range) return true;
        // 同一列
        if (a.x === targetX && Math.abs(a.y - targetY) <= range) return true;
    }

    console.log('目标不在攻击范围内');
    return false;
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

// 检查指定颜色是否还有可行动的船只（放置且未击沉且未行动）
function hasAvailableActions(color) {
    return gameState.ships[color].some(ship => ship.placed && !ship.sunk && !ship.actionTaken);
}

// 如果当前玩家没有可行动的船只，则自动结束回合（与手动 endTurn 行为一致）
function maybeAutoEndTurn(color) {
    if (gameState.gamePhase !== 'playing') return;
    if (gameState.currentTurn !== color) return;

    // 检查是否一方全部被击沉
    const redAllSunk = gameState.ships.red.every(s => s.sunk === true);
    const blueAllSunk = gameState.ships.blue.every(s => s.sunk === true);
    if (redAllSunk || blueAllSunk) {
        //延迟2秒后宣布游戏结束，确保攻击动画能完整播放
        setTimeout(() => {
            gameState.gamePhase = 'ended';
            const winner = redAllSunk ? 'blue' : 'red';
            const loser = winner === 'red' ? 'blue' : 'red';
            console.log(`游戏结束！${winner} 方获胜！`);

            // 结算信息
            const settlement = {
                winner: winner,
                loser: loser,
                winnerName: COLOR_NAME[winner],
                loserName: COLOR_NAME[loser],
                totalTurns: gameState.turnCount,
                lastBlow: gameState.lastBlow,
                // 关键战报摘要：击沉事件
                sunkEvents: gameState.battleLog.filter(e => e.type === 'sunk').map(e => ({
                    turn: e.turn,
                    message: e.message
                })),
                // 双方剩余船只
                redRemaining: gameState.ships.red.filter(s => !s.sunk).length,
                blueRemaining: gameState.ships.blue.filter(s => !s.sunk).length,
                redSunk: gameState.ships.red.filter(s => s.sunk).length,
                blueSunk: gameState.ships.blue.filter(s => s.sunk).length
            };

            addBattleLog({
                type: 'gameEnd',
                winner: winner,
                winnerName: COLOR_NAME[winner],
                loser: loser,
                loserName: COLOR_NAME[loser],
                totalTurns: gameState.turnCount,
                message: `游戏结束！${COLOR_NAME[winner]} 获胜！共 ${gameState.turnCount} 回合`
            });

            io.emit('gameEnded', settlement);
        }, 2200);
    }else if (!hasAvailableActions(color)) {
        console.log(`${color} 方没有可行动的船只，自动结束回合`);

        addBattleLog({
            type: 'endTurn',
            color: color,
            colorName: COLOR_NAME[color],
            turn: gameState.turnCount,
            manual: false,
            message: `${COLOR_NAME[color]} 没有可行动的船只，自动结束回合（第 ${gameState.turnCount} 回合）`
        });

        // 延迟2秒后执行，确保客户端有时间更新消息
        setTimeout(() => {
            // 切换回合
            if (gameState.gamePhase !== 'playing') return;
            if (gameState.currentTurn !== color) return;
            gameState.currentTurn = gameState.currentTurn === 'red' ? 'blue' : 'red';
            // 每完成一轮（蓝方回合结束）增加回合计数
            if (gameState.currentTurn === 'red') {
                gameState.turnCount++;
            }
            // 重置当前玩家所有船只的行动状态（为下一轮准备）
            resetShipActions(gameState.currentTurn);

            addBattleLog({
                type: 'turnStart',
                color: gameState.currentTurn,
                colorName: COLOR_NAME[gameState.currentTurn],
                turn: gameState.turnCount,
                message: `第 ${gameState.turnCount} 回合开始，${COLOR_NAME[gameState.currentTurn]} 行动`
            });

            io.emit('turnChanged', gameState.currentTurn);
            io.emit('gameStateUpdate', gameState);
        }, 2200);

    }
}
