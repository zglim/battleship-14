/**
 * server.js —— Battleship 游戏服务器入口
 *
 * 职责划分：
 *  - shared/game-config.js : 所有游戏常量（棋盘尺寸、船只属性、时间参数等）
 *  - shared/game-rules.js  : 纯规则校验函数（无副作用，可单测）
 *  - server.js (本文件)    : Socket 事件处理 + 对局状态变更
 */

'use strict';

const express  = require('express');
const http     = require('http');
const socketIo = require('socket.io');
const path     = require('path');

const GameConfig = require('./shared/game-config');
const GameRules  = require('./shared/game-rules');

/* ====================================================
 * Express / Socket.io 初始化
 * ==================================================== */
const app    = express();
const server = http.createServer(app);
const io     = socketIo(server);

// 静态文件：public（HTML/CSS/前端JS） + shared（共用规则）
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

/* ====================================================
 * 对局状态（单一可变状态对象）
 * ==================================================== */
const gameState = {
  players:    {},
  boardSize:  GameConfig.BOARD_SIZE,
  obstacles:  [],
  currentTurn: 'red',
  gamePhase:  'setup',   // 'setup' | 'playing' | 'ended'
  ships: { red: [], blue: [] }
};

/* ====================================================
 * 对局状态操作函数
 * ==================================================== */

function initializeGame() {
  gameState.obstacles   = GameRules.generateObstacles(gameState.boardSize);
  gameState.currentTurn = 'red';
  gameState.gamePhase   = 'setup';
  gameState.ships.red   = GameRules.generateShipList('red');
  gameState.ships.blue  = GameRules.generateShipList('blue');
}

function resetShipActions(color) {
  const ships = gameState.ships[color];
  for (let i = 0; i < ships.length; i++) ships[i].actionTaken = false;
}

/** 将两色船只合并成一个数组（用于碰撞检测） */
function allPlacedShips() {
  return gameState.ships.red.concat(gameState.ships.blue);
}

/* ====================================================
 * 放置阶段
 * ==================================================== */

function tryPlaceShip(shipId, x, y, direction, color) {
  const ship = gameState.ships[color].find(s => s.id === shipId);
  if (!ship || ship.placed) return { success: false, message: '船只不存在或已放置' };

  const valid = GameRules.isValidPlacement(
    ship, x, y, direction, color,
    gameState.obstacles, gameState.ships[color], gameState.boardSize
  );
  if (!valid) return { success: false, message: '放置位置不合法' };

  ship.x         = x;
  ship.y         = y;
  ship.direction = direction;
  ship.placed    = true;
  ship.ready     = true;
  return { success: true, ship };
}

function isSetupComplete() {
  const total = GameRules.totalShipCount();
  const redDone   = gameState.ships.red.filter(s => s.placed).length   === total;
  const blueDone  = gameState.ships.blue.filter(s => s.placed).length  === total;
  const redConn   = Object.values(gameState.players).some(p => p.color === 'red');
  const blueConn  = Object.values(gameState.players).some(p => p.color === 'blue');
  return redDone && blueDone && redConn && blueConn;
}

/* ====================================================
 * 战斗阶段：动作处理
 * ==================================================== */

function processShipAction(action, color) {
  const ship = gameState.ships[color].find(s => s.id === action.shipId);
  if (!ship || ship.actionTaken) {
    return { success: false, message: '船只无法行动' };
  }

  switch (action.type) {
    case 'move':   return doMove(ship, action);
    case 'attack': return doAttack(ship, action, color);
    case 'rotate': return doRotate(ship, action);
    default:       return { success: false, message: '未知的动作类型' };
  }
}

function doMove(ship, action) {
  if (action.targetX === ship.x && action.targetY === ship.y) {
    return { success: false, message: '无效的移动位置' };
  }
  const valid = GameRules.isValidMove(
    ship, action.targetX, action.targetY,
    gameState.obstacles, allPlacedShips(), gameState.boardSize
  );
  if (!valid) return { success: false, message: '无效的移动位置' };

  ship.x = action.targetX;
  ship.y = action.targetY;
  ship.actionTaken = true;
  return { success: true, message: '移动成功' };
}

function doRotate(ship, action) {
  const newDir = ship.direction === 'horizontal' ? 'vertical' : 'horizontal';
  const valid = GameRules.isValidRotation(
    ship.id, newDir, ship.size, action.targetX, action.targetY,
    gameState.obstacles, allPlacedShips(), gameState.boardSize
  );
  if (!valid) return { success: false, message: '转向后位置无效' };

  ship.x         = action.targetX;
  ship.y         = action.targetY;
  ship.direction = newDir;
  ship.actionTaken = true;
  return { success: true, message: '转向成功' };
}

function doAttack(ship, action, color) {
  const enemyColor = color === 'red' ? 'blue' : 'red';
  const enemyShips = gameState.ships[enemyColor];

  const valid = GameRules.isValidAttack(ship, action.targetX, action.targetY, enemyShips, gameState.boardSize);
  if (!valid) return { success: false, message: '无效的攻击位置' };

  // 掷骰
  const dice = GameRules.rollDice();
  const power = GameRules.computeAttackPower(dice, ship.size);

  // 应用伤害
  const target = GameRules.findTargetShip(action.targetX, action.targetY, enemyShips);
  if (target && power > 0) {
    target.health = Math.max(0, target.health - power);
    if (target.health <= 0) target.sunk = true;
  }

  ship.actionTaken = true;

  // 通知所有客户端攻击结果（动画用）
  io.emit('attackResult', {
    success: true,
    targetX: action.targetX,
    targetY: action.targetY,
    attackPower: power
  });

  return {
    success: true,
    message: `攻击！骰子点数: ${dice}, ${power > 0 ? `伤害: ${power}` : '没打中！'}`,
    attackPower: power,
    diceRoll: dice,
    x: action.targetX,
    y: action.targetY
  };
}

/* ====================================================
 * 回合流转
 * ==================================================== */

function switchTurn() {
  gameState.currentTurn = gameState.currentTurn === 'red' ? 'blue' : 'red';
  resetShipActions(gameState.currentTurn);
  io.emit('turnChanged', gameState.currentTurn);
  io.emit('gameStateUpdate', gameState);
}

function maybeAutoEndTurn(color) {
  if (gameState.gamePhase !== 'playing' || gameState.currentTurn !== color) return;

  // 游戏结束检测
  const redAllSunk  = GameRules.allSunk(gameState.ships.red);
  const blueAllSunk = GameRules.allSunk(gameState.ships.blue);
  if (redAllSunk || blueAllSunk) {
    setTimeout(() => {
      if (gameState.gamePhase !== 'playing') return;
      gameState.gamePhase = 'ended';
      const winner = redAllSunk ? 'blue' : 'red';
      io.emit('gameEnded', { winner, loser: winner === 'red' ? 'blue' : 'red' });
    }, GameConfig.GAME_END_DELAY);
    return;
  }

  // 自动结束回合
  if (!GameRules.hasAvailableActions(gameState.ships[color])) {
    setTimeout(() => {
      if (gameState.gamePhase !== 'playing' || gameState.currentTurn !== color) return;
      switchTurn();
    }, GameConfig.TURN_SWITCH_DELAY);
  }
}

/* ====================================================
 * Socket.io 事件处理
 * ==================================================== */
io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  socket.on('joinGame', (playerColor) => {
    gameState.players[socket.id] = { color: playerColor, ready: false };
    if (gameState.gamePhase === 'ended') initializeGame();
    socket.emit('gameState', gameState);
    socket.broadcast.emit('playerJoined', playerColor);
  });

  socket.on('placeShip', (data) => {
    const player = gameState.players[socket.id];
    if (!player || gameState.gamePhase !== 'setup') return;

    const result = tryPlaceShip(data.shipId, data.x, data.y, data.direction, player.color);
    if (!result.success) return;

    socket.emit('shipPlaced', result.ship);
    socket.broadcast.emit('opponentShipPlaced', {
      color: player.color,
      shipCount: gameState.ships[player.color].filter(s => s.placed).length
    });
    io.emit('gameStateUpdate', gameState);

    if (isSetupComplete()) {
      gameState.gamePhase = 'playing';
      io.emit('gameStarted', gameState);
    }
  });

  socket.on('shipAction', (data) => {
    const player = gameState.players[socket.id];
    if (!player || gameState.gamePhase !== 'playing' || gameState.currentTurn !== player.color) {
      socket.emit('actionResult', { success: false, message: '当前无法执行动作' });
      return;
    }

    const result = processShipAction(data, player.color);
    if (result.success) {
      io.emit('gameStateUpdate', gameState);
      socket.emit('actionResult', Object.assign({ success: true, animation: data.type, shipId: data.shipId }, result));
      maybeAutoEndTurn(player.color);
    } else {
      socket.emit('actionResult', { success: false, message: result.message });
    }
  });

  socket.on('endTurn', (currentPlayer) => {
    const player = gameState.players[socket.id];
    if (!player || gameState.gamePhase !== 'playing') return;
    if (gameState.currentTurn !== player.color || player.color !== currentPlayer) return;
    switchTurn();
  });

  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    delete gameState.players[socket.id];
  });
});

/* ====================================================
 * 启动
 * ==================================================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Battleship游戏服务器运行在端口 ${PORT}`);
  initializeGame();
});
