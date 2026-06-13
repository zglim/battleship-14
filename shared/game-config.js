/**
 * 游戏配置常量 —— 棋盘、船只、UI、时间等规则参数统一管理
 * 本模块同时被 Node.js (require) 和浏览器 (<script>) 加载
 */
(function (root) {
  'use strict';

  /* ---------- 棋盘 ---------- */
  var BOARD_SIZE = 16;
  var ZONE_BOUNDARY = 8;          // 红方: x < 8, 蓝方: x >= 8
  var EDGE_MARGIN = 4;            // 障碍物生成的左右留白列数

  /* ---------- 船只类型 ---------- */
  var SHIP_TYPES = {
    AIRCRAFT_CARRIER: { name: '航空母舰', size: 4, attackRange: 5, canCrossObstacles: true  },
    BATTLESHIP:       { name: '战列舰',   size: 4, attackRange: 4, canCrossObstacles: false },
    DESTROYER:        { name: '驱逐舰',   size: 3, attackRange: 4, canCrossObstacles: false },
    MISSILE_BOAT:     { name: '导弹艇',   size: 2, attackRange: 4, canCrossObstacles: false },
    COMBAT_BOAT:      { name: '战斗艇',   size: 1, attackRange: 3, canCrossObstacles: false }
  };

  var SHIP_COUNTS = {
    AIRCRAFT_CARRIER: 1,
    BATTLESHIP:       2,
    DESTROYER:        3,
    MISSILE_BOAT:     2,
    COMBAT_BOAT:      2
  };

  /* ---------- 障碍物 ---------- */
  var OBSTACLE_MIN = 5;
  var OBSTACLE_MAX = 16;

  /* ---------- 战斗 ---------- */
  var DICE_FACES = 6;

  /* ---------- UI / 时间 (ms) ---------- */
  var CELL_SIZE_PX       = 40;
  var EXPLOSION_SIZE_PX  = 120;
  var EXPLOSION_DURATION = 1200;
  var MESSAGE_DEFAULT_DURATION = 3000;
  var CENTER_MESSAGE_DURATION  = 2000;
  var TURN_SWITCH_DELAY  = 2200;
  var GAME_END_DELAY     = 2200;

  /* ---------- 导出 ---------- */
  var config = {
    BOARD_SIZE: BOARD_SIZE,
    ZONE_BOUNDARY: ZONE_BOUNDARY,
    EDGE_MARGIN: EDGE_MARGIN,
    SHIP_TYPES: SHIP_TYPES,
    SHIP_COUNTS: SHIP_COUNTS,
    OBSTACLE_MIN: OBSTACLE_MIN,
    OBSTACLE_MAX: OBSTACLE_MAX,
    DICE_FACES: DICE_FACES,
    CELL_SIZE_PX: CELL_SIZE_PX,
    EXPLOSION_SIZE_PX: EXPLOSION_SIZE_PX,
    EXPLOSION_DURATION: EXPLOSION_DURATION,
    MESSAGE_DEFAULT_DURATION: MESSAGE_DEFAULT_DURATION,
    CENTER_MESSAGE_DURATION: CENTER_MESSAGE_DURATION,
    TURN_SWITCH_DELAY: TURN_SWITCH_DELAY,
    GAME_END_DELAY: GAME_END_DELAY
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
  } else {
    root.GameConfig = config;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
