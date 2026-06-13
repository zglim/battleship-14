/**
 * 游戏规则核心函数 —— 纯函数，不依赖任何全局可变状态
 * 同时被 Node.js (require) 和浏览器 (<script>) 加载
 *
 * 所有函数都通过参数接收所需的棋盘/船只数据，
 * 因此可以直接在单元测试中验证，也可以在前后端共用。
 */
(function (root) {
  'use strict';

  var GameConfig = (typeof module !== 'undefined' && module.exports)
    ? require('./game-config')
    : root.GameConfig;

  var BOARD_SIZE      = GameConfig.BOARD_SIZE;
  var ZONE_BOUNDARY   = GameConfig.ZONE_BOUNDARY;
  var DICE_FACES      = GameConfig.DICE_FACES;

  /* ====================================================
   * 基础坐标工具
   * ==================================================== */

  /**
   * 返回船只占据的所有格子坐标 [{x, y}, ...]
   */
  function getShipCells(ship) {
    if (!ship || !ship.placed) return [];
    var cells = [];
    for (var i = 0; i < ship.size; i++) {
      cells.push({
        x: ship.direction === 'horizontal' ? ship.x + i : ship.x,
        y: ship.direction === 'vertical'   ? ship.y + i : ship.y
      });
    }
    return cells;
  }

  /**
   * 判断某船只是否占据了 (x, y) 这一格
   */
  function shipOccupiesCell(ship, x, y) {
    if (!ship || !ship.placed || ship.sunk) return false;
    for (var i = 0; i < ship.size; i++) {
      var cx = ship.direction === 'horizontal' ? ship.x + i : ship.x;
      var cy = ship.direction === 'vertical'   ? ship.y + i : ship.y;
      if (cx === x && cy === y) return true;
    }
    return false;
  }

  /**
   * 在给定位置/方向下，判断某格是否被占据（用于放置/移动校验，不依赖 ship.placed）
   */
  function cellsOverlap(cellsA, cellsB) {
    for (var a = 0; a < cellsA.length; a++) {
      for (var b = 0; b < cellsB.length; b++) {
        if (cellsA[a].x === cellsB[b].x && cellsA[a].y === cellsB[b].y) return true;
      }
    }
    return false;
  }

  /* ====================================================
   * 边界 / 区域判断
   * ==================================================== */

  /** 单格是否在棋盘内 */
  function isInBounds(x, y, boardSize) {
    boardSize = boardSize || BOARD_SIZE;
    return x >= 0 && y >= 0 && x < boardSize && y < boardSize;
  }

  /** 船只在给定位置/方向下所有格子是否都在棋盘内 */
  function isShipInBounds(x, y, direction, size, boardSize) {
    boardSize = boardSize || BOARD_SIZE;
    for (var i = 0; i < size; i++) {
      var cx = direction === 'horizontal' ? x + i : x;
      var cy = direction === 'vertical'   ? y + i : y;
      if (!isInBounds(cx, cy, boardSize)) return false;
    }
    return true;
  }

  /** 船只所有格子是否都在己方区域（红方: x < ZONE_BOUNDARY, 蓝方: x >= ZONE_BOUNDARY）*/
  function isShipInZone(x, y, direction, size, color, boardSize) {
    boardSize = boardSize || BOARD_SIZE;
    for (var i = 0; i < size; i++) {
      var cx = direction === 'horizontal' ? x + i : x;
      var cy = direction === 'vertical'   ? y + i : y;
      var validX = color === 'red' ? cx < ZONE_BOUNDARY : cx >= ZONE_BOUNDARY;
      if (!validX) return false;
    }
    return true;
  }

  /* ====================================================
   * 障碍物 / 船只碰撞
   * ==================================================== */

  /** 给定一组格子，是否与任意障碍物重叠 */
  function collidesWithObstacles(cells, obstacles) {
    for (var c = 0; c < cells.length; c++) {
      for (var o = 0; o < obstacles.length; o++) {
        if (cells[c].x === obstacles[o].x && cells[c].y === obstacles[o].y) return true;
      }
    }
    return false;
  }

  /**
   * 给定一组格子，是否与任意已放置的其他船只重叠
   * @param {Array} cells  待检测格子
   * @param {Array} ships  所有船只列表
   * @param {string|null} excludeShipId  需要排除的船只 id（自身）
   */
  function collidesWithOtherShips(cells, ships, excludeShipId) {
    for (var s = 0; s < ships.length; s++) {
      var ship = ships[s];
      if (!ship.placed || ship.sunk || ship.id === excludeShipId) continue;
      var otherCells = getShipCells(ship);
      if (cellsOverlap(cells, otherCells)) return true;
    }
    return false;
  }

  /* ====================================================
   * 放置阶段：边缘限制
   * ==================================================== */

  /** size > 2 的船只不能贴着棋盘边缘放置 */
  function isShipNotOnEdge(direction, size, x, y, boardSize) {
    boardSize = boardSize || BOARD_SIZE;
    if (size <= 2) return true;
    if (direction === 'horizontal') {
      if (y === 0 || y === boardSize - 1) return false;
    } else {
      if (x === 0 || x === boardSize - 1) return false;
    }
    return true;
  }

  /* ====================================================
   * 放置校验（完整）
   * ==================================================== */

  /**
   * 验证船只放置是否合法
   * @param {Object} ship        船只定义（含 size 字段）
   * @param {number} x           放置 x
   * @param {number} y           放置 y
   * @param {string} direction   'horizontal' | 'vertical'
   * @param {string} color       'red' | 'blue'
   * @param {Array}  obstacles   障碍物列表
   * @param {Array}  allShips    同色所有船只（含当前船只自身）
   * @param {number} [boardSize] 棋盘尺寸
   * @returns {boolean}
   */
  function isValidPlacement(ship, x, y, direction, color, obstacles, allShips, boardSize) {
    boardSize = boardSize || BOARD_SIZE;
    // 边缘限制
    if (!isShipNotOnEdge(direction, ship.size, x, y, boardSize)) return false;
    // 边界
    if (!isShipInBounds(x, y, direction, ship.size, boardSize)) return false;
    // 区域
    if (!isShipInZone(x, y, direction, ship.size, color, boardSize)) return false;
    // 计算占据格
    var cells = [];
    for (var i = 0; i < ship.size; i++) {
      cells.push({
        x: direction === 'horizontal' ? x + i : x,
        y: direction === 'vertical'   ? y + i : y
      });
    }
    // 障碍物
    if (collidesWithObstacles(cells, obstacles)) return false;
    // 其他船只
    if (collidesWithOtherShips(cells, allShips, ship.id)) return false;
    return true;
  }

  /* ====================================================
   * 移动校验
   * ==================================================== */

  /**
   * 判断从 (ship.x, ship.y) 移动到 (newX, newY) 的方向合法性
   * - size==1：上下左右一格（不能斜着走，不能不动）
   * - size>1：水平船只只能水平移动一格，垂直船只只能垂直移动一格
   */
  function isValidMoveDirection(ship, newX, newY) {
    if (ship.size === 1) {
      var dx = Math.abs(newX - ship.x);
      var dy = Math.abs(newY - ship.y);
      // 只能正交移动一格（不能斜走，不能不动）
      if (dx === 0 && dy === 0) return false;
      if (dx > 1 || dy > 1)     return false;
      if (dx === 1 && dy === 1) return false; // 不能斜走
      return true;
    }
    if (ship.direction === 'horizontal') {
      if (newY !== ship.y) return false;
      if (Math.abs(newX - ship.x) !== 1) return false;
      return true;
    }
    // vertical
    if (newX !== ship.x) return false;
    if (Math.abs(newY - ship.y) !== 1) return false;
    return true;
  }

  /**
   * 完整移动校验：方向、边界、障碍物、船只重叠
   * @param {Object} ship          当前船只
   * @param {number} newX          目标 x
   * @param {number} newY          目标 y
   * @param {Array}  obstacles     障碍物列表
   * @param {Array}  allShips      场上所有船只（两色合并，含自身）
   * @param {number} [boardSize]
   * @returns {boolean}
   */
  function isValidMove(ship, newX, newY, obstacles, allShips, boardSize) {
    boardSize = boardSize || BOARD_SIZE;
    if (!isValidMoveDirection(ship, newX, newY)) return false;

    var cells = [];
    for (var i = 0; i < ship.size; i++) {
      cells.push({
        x: ship.direction === 'horizontal' ? newX + i : newX,
        y: ship.direction === 'vertical'   ? newY + i : newY
      });
    }
    // 边界
    for (var c = 0; c < cells.length; c++) {
      if (!isInBounds(cells[c].x, cells[c].y, boardSize)) return false;
    }
    // 障碍物
    if (collidesWithObstacles(cells, obstacles)) return false;
    // 与其他船只碰撞（双方船只都要检查）
    if (collidesWithOtherShips(cells, allShips, ship.id)) return false;
    return true;
  }

  /* ====================================================
   * 转向校验（仅位置合法性，方向切换由调用方处理）
   * ==================================================== */

  /**
   * @param {string} shipId
   * @param {string} newDirection  转向后的方向
   * @param {number} size
   * @param {number} targetX       转向后的锚点 x
   * @param {number} targetY       转向后的锚点 y
   * @param {Array}  obstacles
   * @param {Array}  allShips      两色合并
   * @param {number} [boardSize]
   */
  function isValidRotation(shipId, newDirection, size, targetX, targetY, obstacles, allShips, boardSize) {
    boardSize = boardSize || BOARD_SIZE;
    if (!isShipInBounds(targetX, targetY, newDirection, size, boardSize)) return false;

    var cells = [];
    for (var i = 0; i < size; i++) {
      cells.push({
        x: newDirection === 'horizontal' ? targetX + i : targetX,
        y: newDirection === 'vertical'   ? targetY + i : targetY
      });
    }
    if (collidesWithObstacles(cells, obstacles)) return false;
    if (collidesWithOtherShips(cells, allShips, shipId)) return false;
    return true;
  }

  /* ====================================================
   * 攻击校验
   * ==================================================== */

  /**
   * 目标格是否是某艘敌方船只的一部分
   */
  function isEnemyCell(x, y, enemyShips) {
    for (var s = 0; s < enemyShips.length; s++) {
      if (shipOccupiesCell(enemyShips[s], x, y)) return true;
    }
    return false;
  }

  /**
   * 目标是否在攻击范围内（同行或同列，距离 <= attackRange）
   */
  function isWithinAttackRange(attackerShip, targetX, targetY) {
    var range = attackerShip.attackRange || 0;
    var attackerCells = getShipCells(attackerShip);
    for (var i = 0; i < attackerCells.length; i++) {
      var a = attackerCells[i];
      if (a.y === targetY && Math.abs(a.x - targetX) <= range) return true;
      if (a.x === targetX && Math.abs(a.y - targetY) <= range) return true;
    }
    return false;
  }

  /**
   * 完整攻击校验
   * @param {Object} attackerShip  攻击方船只（需已放置、未沉没）
   * @param {number} targetX
   * @param {number} targetY
   * @param {Array}  enemyShips    敌方船只列表
   * @param {number} [boardSize]
   * @returns {boolean}
   */
  function isValidAttack(attackerShip, targetX, targetY, enemyShips, boardSize) {
    boardSize = boardSize || BOARD_SIZE;
    if (!isInBounds(targetX, targetY, boardSize)) return false;
    if (!isEnemyCell(targetX, targetY, enemyShips)) return false;
    if (!isWithinAttackRange(attackerShip, targetX, targetY)) return false;
    return true;
  }

  /**
   * 骰子 → 攻击力映射
   * 1 → 1, 2 → 2, 6 → ship.size（满伤害）, 3-5 → 0
   */
  function computeAttackPower(diceRoll, shipSize) {
    if (diceRoll === 1) return 1;
    if (diceRoll === 2) return 2;
    if (diceRoll === DICE_FACES) return shipSize;
    return 0;
  }

  /** 掷骰子 */
  function rollDice() {
    return Math.floor(Math.random() * DICE_FACES) + 1;
  }

  /* ====================================================
   * 船只列表生成
   * ==================================================== */

  function generateShipList(color) {
    var SHIP_TYPES = GameConfig.SHIP_TYPES;
    var SHIP_COUNTS = GameConfig.SHIP_COUNTS;
    var ships = [];
    var keys = Object.keys(SHIP_COUNTS);
    for (var k = 0; k < keys.length; k++) {
      var typeKey = keys[k];
      var count = SHIP_COUNTS[typeKey];
      var shipType = SHIP_TYPES[typeKey];
      for (var i = 1; i <= count; i++) {
        ships.push({
          id: color + '-' + typeKey.toLowerCase() + '-' + i,
          type: typeKey.toLowerCase(),
          name: shipType.name + ' ' + i,
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

  /** 总船只数量 */
  function totalShipCount() {
    var counts = GameConfig.SHIP_COUNTS;
    var total = 0;
    var keys = Object.keys(counts);
    for (var i = 0; i < keys.length; i++) total += counts[keys[i]];
    return total;
  }

  /* ====================================================
   * 障碍物生成
   * ==================================================== */

  function generateObstacles(boardSize) {
    boardSize = boardSize || BOARD_SIZE;
    var obstacles = [];
    var count = Math.floor(Math.random() * (GameConfig.OBSTACLE_MAX - GameConfig.OBSTACLE_MIN + 1)) + GameConfig.OBSTACLE_MIN;
    var EDGE_MARGIN = GameConfig.EDGE_MARGIN;

    for (var i = 0; i < count; i++) {
      var x, y, dup;
      do {
        x = Math.floor(Math.random() * (boardSize - EDGE_MARGIN * 2)) + EDGE_MARGIN;
        y = Math.floor(Math.random() * boardSize);
        dup = false;
        for (var j = 0; j < obstacles.length; j++) {
          if (obstacles[j].x === x && obstacles[j].y === y) { dup = true; break; }
        }
      } while (dup);
      obstacles.push({ x: x, y: y });
    }
    return obstacles;
  }

  /* ====================================================
   * 对局状态查询辅助
   * ==================================================== */

  /** 某颜色是否还有可行动船只 */
  function hasAvailableActions(ships) {
    for (var i = 0; i < ships.length; i++) {
      if (ships[i].placed && !ships[i].sunk && !ships[i].actionTaken) return true;
    }
    return false;
  }

  /** 某颜色的船只是否全部沉没 */
  function allSunk(ships) {
    for (var i = 0; i < ships.length; i++) {
      if (!ships[i].sunk) return false;
    }
    return true;
  }

  /** 找到目标格对应的敌方船只 */
  function findTargetShip(x, y, ships) {
    for (var s = 0; s < ships.length; s++) {
      if (shipOccupiesCell(ships[s], x, y)) return ships[s];
    }
    return null;
  }

  /* ====================================================
   * 导出
   * ==================================================== */
  var rules = {
    // 坐标工具
    getShipCells: getShipCells,
    shipOccupiesCell: shipOccupiesCell,
    cellsOverlap: cellsOverlap,
    // 边界 / 区域
    isInBounds: isInBounds,
    isShipInBounds: isShipInBounds,
    isShipInZone: isShipInZone,
    isShipNotOnEdge: isShipNotOnEdge,
    // 碰撞
    collidesWithObstacles: collidesWithObstacles,
    collidesWithOtherShips: collidesWithOtherShips,
    // 完整校验
    isValidPlacement: isValidPlacement,
    isValidMoveDirection: isValidMoveDirection,
    isValidMove: isValidMove,
    isValidRotation: isValidRotation,
    isValidAttack: isValidAttack,
    isEnemyCell: isEnemyCell,
    isWithinAttackRange: isWithinAttackRange,
    // 战斗
    computeAttackPower: computeAttackPower,
    rollDice: rollDice,
    // 船只
    generateShipList: generateShipList,
    totalShipCount: totalShipCount,
    findTargetShip: findTargetShip,
    // 障碍物
    generateObstacles: generateObstacles,
    // 对局辅助
    hasAvailableActions: hasAvailableActions,
    allSunk: allSunk
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = rules;
  } else {
    root.GameRules = rules;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
