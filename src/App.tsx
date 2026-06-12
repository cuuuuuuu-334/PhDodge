import { useEffect, useRef, useState } from 'react';

type GameState = 'START' | 'PLAYING' | 'GAMEOVER';

interface Player {
  x: number;
  y: number;
  radius: number;
  speed: number;
  color: string;
  history: { x: number; y: number }[];
}

type EnemyType =
  | 'standard'
  | 'burst'
  | 'homing'
  | 'child'
  | 'dash'
  | 'zigzag'
  | 'giant'
  | 'spike'
  | 'wall';

interface Enemy {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  type: EnemyType;
  lifeTimer?: number;
  timer?: number;
  baseVx?: number;
  baseVy?: number;
  phase?: number;
  angle?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface ScheduledEnemy {
  triggerTime: number;
  enemy: Enemy;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  speed: number;
  thickness: number;
  color: string;
  warningUntil: number;
}

const HIGH_SCORE_KEY = 'phdodgeHighScore';

// Debug switch.
// Set this to true when you want to test late-game patterns without dying.
const IS_INVINCIBLE_MODE = true;

const MAX_ENEMIES = 165;
const MAX_GIANTS = 3;
const MAX_HOMING = 10;
const MAX_BURST = 6;
const MAX_CHILDREN = 42;
const MAX_SPIKES = 36;
const MAX_WALL_BALLS = 44;
const MAX_SHOCKWAVES = 2;

const INITIAL_SPAWN_RATE = 600;
const MIN_SPAWN_RATE = 190;
const BURST_CHILD_COUNT = 7;

const ARC_SPIKE_START_SCORE = 8;
const ARC_SPIKE_COOLDOWN = 3200;
const ARC_SPIKE_COUNT = 9;
const ARC_SPIKE_DELAY = 55;

const SHOCKWAVE_START_SCORE = 11;
const SHOCKWAVE_COOLDOWN = 5200;
const SHOCKWAVE_WARNING_TIME = 850;

const SHOCKWAVE_SPIKE_COUNT = 32;
const SHOCKWAVE_GAP_EVERY = 4;
const SHOCKWAVE_SPIKE_HALF_ANGLE = Math.PI / 54;
const SHOCKWAVE_INNER_OFFSET = 9;
const SHOCKWAVE_OUTER_OFFSET = 14;

const DEADLINE_WALL_START_SCORE = 15;
const DEADLINE_WALL_COOLDOWN = 5600;
const WALL_GAP_SIZE = 155;
const WALL_SPACING = 34;

const normalizeAngle = (angle: number) => {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
};

const angularDistance = (a: number, b: number) => {
  const full = Math.PI * 2;
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, full - diff);
};

const getShockwavePhase = () => {
  return 0;
};

const isShockwaveSpikeActive = (index: number) => {
  return index % SHOCKWAVE_GAP_EVERY !== 0;
};

const isShockwaveAngleDangerous = (
  angle: number,
  shockwave: Shockwave,
  playerRadius: number,
) => {
  const phase = getShockwavePhase();
  const spacing = (Math.PI * 2) / SHOCKWAVE_SPIKE_COUNT;
  const expandedHalfAngle =
    SHOCKWAVE_SPIKE_HALF_ANGLE +
    Math.min(0.08, playerRadius / Math.max(shockwave.radius, 1));

  for (let i = 0; i < SHOCKWAVE_SPIKE_COUNT; i++) {
    if (!isShockwaveSpikeActive(i)) continue;

    const spikeAngle = phase + i * spacing;

    if (angularDistance(angle, spikeAngle) < expandedHalfAngle) {
      return true;
    }
  }

  return false;
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [gameState, setGameState] = useState<GameState>('START');
  const [score, setScore] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;

    const saved = window.localStorage.getItem(HIGH_SCORE_KEY);
    return saved ? parseFloat(saved) : 0;
  });

  const playerRef = useRef<Player>({
    x: 400,
    y: 300,
    radius: 10,
    speed: 8.5,
    color: '#38bdf8',
    history: [],
  });

  const enemiesRef = useRef<Enemy[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const scheduledEnemiesRef = useRef<ScheduledEnemy[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const keysRef = useRef<{ [key: string]: boolean }>({});

  const scoreRef = useRef<number>(0);
  const lastUIUpdateRef = useRef<number>(0);
  const lastSpawnRef = useRef<number>(0);
  const lastArcSpikeRef = useRef<number>(0);
  const lastShockwaveRef = useRef<number>(0);
  const lastDeadlineWallRef = useRef<number>(0);
  const lastInvincibleSparkRef = useRef<number>(0);
  const animationFrameId = useRef<number>(0);

  const countEnemiesByType = (type: EnemyType) => {
    return enemiesRef.current.filter((enemy) => enemy.type === type).length;
  };

  const initGame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    playerRef.current = {
      x: canvas.width / 2,
      y: canvas.height / 2,
      radius: 10,
      speed: 8.5,
      color: '#38bdf8',
      history: [],
    };

    enemiesRef.current = [];
    particlesRef.current = [];
    scheduledEnemiesRef.current = [];
    shockwavesRef.current = [];
    keysRef.current = {};

    scoreRef.current = 0;
    lastUIUpdateRef.current = performance.now();
    lastSpawnRef.current = 0;
    lastArcSpikeRef.current = 0;
    lastShockwaveRef.current = 0;
    lastDeadlineWallRef.current = 0;
    lastInvincibleSparkRef.current = 0;

    setScore(0);
    setGameState('PLAYING');
  };

  const createExplosion = (
    x: number,
    y: number,
    color: string,
    count: number = 15,
  ) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 3 + 1;

      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: Math.random() * 30 + 20,
        color,
        size: Math.random() * 3 + 1,
      });
    }
  };

  const handlePlayerHit = (time: number) => {
    const player = playerRef.current;

    if (IS_INVINCIBLE_MODE) {
      if (time - lastInvincibleSparkRef.current > 120) {
        createExplosion(player.x, player.y, player.color, 7);
        lastInvincibleSparkRef.current = time;
      }

      return false;
    }

    createExplosion(player.x, player.y, player.color, 50);
    return true;
  };

  const spawnEnemy = (canvasWidth: number, canvasHeight: number) => {
    if (enemiesRef.current.length >= MAX_ENEMIES) return;

    const currentScore = scoreRef.current;
    const difficulty = Math.min(currentScore / 35, 1);

    let type: EnemyType = 'standard';
    let color = '#f43f5e';
    let radius = Math.random() * 6 + 8;
    let speedMultiplier = Math.random() * 1.5 + 2.2 + difficulty * 2.2;

    if (currentScore > 2.5) {
      const rand = Math.random();

      if (rand < 0.08 && countEnemiesByType('burst') < MAX_BURST) {
        type = 'burst';
        color = '#a855f7';
        radius = 14;
        speedMultiplier = 1.2 + difficulty * 0.8;
      } else if (rand < 0.2 && countEnemiesByType('homing') < MAX_HOMING) {
        type = 'homing';
        color = '#fb923c';
        radius = 10;
        speedMultiplier = 2.0 + difficulty * 1.8;
      } else if (rand < 0.34) {
        type = 'dash';
        color = '#eab308';
        radius = 11;
        speedMultiplier = 1.1;
      } else if (rand < 0.48) {
        type = 'zigzag';
        color = '#22c55e';
        radius = 9;
        speedMultiplier = 3.0 + difficulty * 2.0;
      } else if (rand < 0.55 && countEnemiesByType('giant') < MAX_GIANTS) {
        type = 'giant';
        color = '#6366f1';
        radius = Math.random() * 12 + 28;
        speedMultiplier = 1.1 + difficulty * 1.1;
      }
    }

    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;

    const edge = Math.floor(Math.random() * 4);

    if (edge === 0) {
      x = Math.random() * canvasWidth;
      y = -radius;
      vx = (Math.random() - 0.5) * speedMultiplier;
      vy = Math.random() * speedMultiplier + 1;
    } else if (edge === 1) {
      x = canvasWidth + radius;
      y = Math.random() * canvasHeight;
      vx = -(Math.random() * speedMultiplier + 1);
      vy = (Math.random() - 0.5) * speedMultiplier;
    } else if (edge === 2) {
      x = Math.random() * canvasWidth;
      y = canvasHeight + radius;
      vx = (Math.random() - 0.5) * speedMultiplier;
      vy = -(Math.random() * speedMultiplier + 1);
    } else {
      x = -radius;
      y = Math.random() * canvasHeight;
      vx = Math.random() * speedMultiplier + 1;
      vy = (Math.random() - 0.5) * speedMultiplier;
    }

    enemiesRef.current.push({
      x,
      y,
      vx,
      vy,
      radius,
      color,
      type,
      baseVx: vx,
      baseVy: vy,
      timer: 0,
      phase: Math.random() * Math.PI * 2,
      lifeTimer: type === 'burst' ? Math.floor(Math.random() * 60 + 55) : 0,
      angle: Math.atan2(vy, vx),
    });
  };

  const spawnArcSpikeWave = (
    canvasWidth: number,
    canvasHeight: number,
    time: number,
  ) => {
    if (countEnemiesByType('spike') >= MAX_SPIKES) return;

    const currentScore = scoreRef.current;
    const difficulty = Math.min(currentScore / 40, 1);
    const edge = Math.floor(Math.random() * 4);

    let originX = 0;
    let originY = 0;

    if (edge === 0) {
      originX = Math.random() * canvasWidth;
      originY = -30;
    } else if (edge === 1) {
      originX = canvasWidth + 30;
      originY = Math.random() * canvasHeight;
    } else if (edge === 2) {
      originX = Math.random() * canvasWidth;
      originY = canvasHeight + 30;
    } else {
      originX = -30;
      originY = Math.random() * canvasHeight;
    }

    const player = playerRef.current;
    const baseAngle = Math.atan2(player.y - originY, player.x - originX);
    const arcSpread = 0.55 + difficulty * 0.35;
    const spikeSpeed = 4.2 + difficulty * 1.8;
    const middle = (ARC_SPIKE_COUNT - 1) / 2;

    createExplosion(originX, originY, '#38bdf8', 8);

    for (let i = 0; i < ARC_SPIKE_COUNT; i++) {
      const offset = ((i - middle) / middle) * arcSpread;
      const angle = baseAngle + offset;
      const delay = i * ARC_SPIKE_DELAY;

      scheduledEnemiesRef.current.push({
        triggerTime: time + delay,
        enemy: {
          x: originX,
          y: originY,
          vx: Math.cos(angle) * spikeSpeed,
          vy: Math.sin(angle) * spikeSpeed,
          radius: 10,
          color: '#67e8f9',
          type: 'spike',
          baseVx: Math.cos(angle) * spikeSpeed,
          baseVy: Math.sin(angle) * spikeSpeed,
          angle,
          timer: 0,
        },
      });
    }
  };

  const spawnCommitteeShockwave = (
    canvasWidth: number,
    canvasHeight: number,
    time: number,
  ) => {
    if (shockwavesRef.current.length >= MAX_SHOCKWAVES) return;

    const margin = 90;
    const x = margin + Math.random() * (canvasWidth - margin * 2);
    const y = margin + Math.random() * (canvasHeight - margin * 2);
    const difficulty = Math.min(scoreRef.current / 45, 1);

    shockwavesRef.current.push({
      x,
      y,
      radius: 8,
      maxRadius: Math.hypot(canvasWidth, canvasHeight),
      speed: 3.2 + difficulty * 1.0,
      thickness: 16,
      color: '#f8fafc',
      warningUntil: time + SHOCKWAVE_WARNING_TIME,
    });

    createExplosion(x, y, '#f8fafc', 10);
  };

  const spawnDeadlineWall = (canvasWidth: number, canvasHeight: number) => {
    if (countEnemiesByType('wall') >= MAX_WALL_BALLS) return;
    if (enemiesRef.current.length > MAX_ENEMIES - 24) return;

    const direction = Math.floor(Math.random() * 4);
    const difficulty = Math.min(scoreRef.current / 40, 1);
    const speed = 4.1 + difficulty * 1.2;
    const radius = 9;
    const color = '#ef4444';

    if (direction === 0 || direction === 1) {
      const fromLeft = direction === 0;
      const x = fromLeft ? -radius * 2 : canvasWidth + radius * 2;
      const vx = fromLeft ? speed : -speed;
      const gapCenter =
        WALL_GAP_SIZE / 2 + Math.random() * (canvasHeight - WALL_GAP_SIZE);

      for (let y = 20; y <= canvasHeight - 20; y += WALL_SPACING) {
        if (Math.abs(y - gapCenter) < WALL_GAP_SIZE / 2) continue;
        if (enemiesRef.current.length >= MAX_ENEMIES) break;
        if (countEnemiesByType('wall') >= MAX_WALL_BALLS) break;

        enemiesRef.current.push({
          x,
          y,
          vx,
          vy: 0,
          radius,
          color,
          type: 'wall',
          angle: fromLeft ? 0 : Math.PI,
        });
      }
    } else {
      const fromTop = direction === 2;
      const y = fromTop ? -radius * 2 : canvasHeight + radius * 2;
      const vy = fromTop ? speed : -speed;
      const gapCenter =
        WALL_GAP_SIZE / 2 + Math.random() * (canvasWidth - WALL_GAP_SIZE);

      for (let x = 20; x <= canvasWidth - 20; x += WALL_SPACING) {
        if (Math.abs(x - gapCenter) < WALL_GAP_SIZE / 2) continue;
        if (enemiesRef.current.length >= MAX_ENEMIES) break;
        if (countEnemiesByType('wall') >= MAX_WALL_BALLS) break;

        enemiesRef.current.push({
          x,
          y,
          vx: 0,
          vy,
          radius,
          color,
          type: 'wall',
          angle: fromTop ? Math.PI / 2 : -Math.PI / 2,
        });
      }
    }
  };

  const processScheduledEnemies = (time: number) => {
    const scheduled = scheduledEnemiesRef.current;

    for (let i = scheduled.length - 1; i >= 0; i--) {
      const item = scheduled[i];

      if (time >= item.triggerTime) {
        if (
          enemiesRef.current.length < MAX_ENEMIES &&
          countEnemiesByType('spike') < MAX_SPIKES
        ) {
          enemiesRef.current.push(item.enemy);
        }

        scheduled.splice(i, 1);
      }
    }
  };

  const drawSpike = (ctx: CanvasRenderingContext2D, enemy: Enemy) => {
    const angle = enemy.angle ?? Math.atan2(enemy.vy, enemy.vx);
    const length = enemy.radius * 2.4;
    const width = enemy.radius * 1.35;

    const tipX = enemy.x + Math.cos(angle) * length;
    const tipY = enemy.y + Math.sin(angle) * length;

    const backX = enemy.x - Math.cos(angle) * enemy.radius * 0.8;
    const backY = enemy.y - Math.sin(angle) * enemy.radius * 0.8;

    const leftX = backX + Math.cos(angle + Math.PI / 2) * width;
    const leftY = backY + Math.sin(angle + Math.PI / 2) * width;

    const rightX = backX + Math.cos(angle - Math.PI / 2) * width;
    const rightY = backY + Math.sin(angle - Math.PI / 2) * width;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();

    ctx.fillStyle = enemy.color;
    ctx.shadowBlur = 18;
    ctx.shadowColor = enemy.color;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(enemy.x, enemy.y);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  const drawShockwave = (
    ctx: CanvasRenderingContext2D,
    shockwave: Shockwave,
    time: number,
  ) => {
    const isWarning = time < shockwave.warningUntil;

    if (isWarning) {
      const remaining = shockwave.warningUntil - time;
      const progress = 1 - remaining / SHOCKWAVE_WARNING_TIME;
      const pulseRadius = 18 + Math.sin(time / 60) * 4;

      ctx.save();
      ctx.globalAlpha = 0.45 + progress * 0.35;
      ctx.strokeStyle = shockwave.color;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 18;
      ctx.shadowColor = shockwave.color;

      ctx.beginPath();
      ctx.arc(
        shockwave.x,
        shockwave.y,
        pulseRadius + progress * 28,
        0,
        Math.PI * 2,
      );
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(shockwave.x - 18, shockwave.y);
      ctx.lineTo(shockwave.x + 18, shockwave.y);
      ctx.moveTo(shockwave.x, shockwave.y - 18);
      ctx.lineTo(shockwave.x, shockwave.y + 18);
      ctx.stroke();

      ctx.restore();
      return;
    }

    const phase = getShockwavePhase();
    const spacing = (Math.PI * 2) / SHOCKWAVE_SPIKE_COUNT;
    const baseRadius = Math.max(1, shockwave.radius - SHOCKWAVE_INNER_OFFSET);
    const tipRadius = shockwave.radius + SHOCKWAVE_OUTER_OFFSET;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 18;
    ctx.shadowColor = shockwave.color;

    for (let i = 0; i < SHOCKWAVE_SPIKE_COUNT; i++) {
      if (!isShockwaveSpikeActive(i)) continue;

      const angle = phase + i * spacing;

      const tipX = shockwave.x + Math.cos(angle) * tipRadius;
      const tipY = shockwave.y + Math.sin(angle) * tipRadius;

      const leftAngle = angle - SHOCKWAVE_SPIKE_HALF_ANGLE;
      const rightAngle = angle + SHOCKWAVE_SPIKE_HALF_ANGLE;

      const leftX = shockwave.x + Math.cos(leftAngle) * baseRadius;
      const leftY = shockwave.y + Math.sin(leftAngle) * baseRadius;

      const rightX = shockwave.x + Math.cos(rightAngle) * baseRadius;
      const rightY = shockwave.y + Math.sin(rightAngle) * baseRadius;

      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();

      ctx.fillStyle = shockwave.color;
      ctx.fill();

      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 0.9;
    }

    ctx.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTime = performance.now();

    const gameLoop = (time: number) => {
      if (gameState !== 'PLAYING') return;

      const deltaTime = time - lastTime;
      lastTime = time;

      const player = playerRef.current;
      const keys = keysRef.current;

      player.history.unshift({ x: player.x, y: player.y });
      if (player.history.length > 15) {
        player.history.pop();
      }

      let moveX = 0;
      let moveY = 0;

      if (keys.ArrowUp || keys.w || keys.W) moveY -= 1;
      if (keys.ArrowDown || keys.s || keys.S) moveY += 1;
      if (keys.ArrowLeft || keys.a || keys.A) moveX -= 1;
      if (keys.ArrowRight || keys.d || keys.D) moveX += 1;

      const moveLength = Math.hypot(moveX, moveY);

      if (moveLength > 0) {
        player.x += (moveX / moveLength) * player.speed;
        player.y += (moveY / moveLength) * player.speed;
      }

      player.x = Math.max(
        player.radius,
        Math.min(canvas.width - player.radius, player.x),
      );
      player.y = Math.max(
        player.radius,
        Math.min(canvas.height - player.radius, player.y),
      );

      processScheduledEnemies(time);

      const currentSpawnRate = Math.max(
        MIN_SPAWN_RATE,
        INITIAL_SPAWN_RATE - scoreRef.current * 8,
      );

      const spawnCount =
        scoreRef.current > 20 && enemiesRef.current.length < 95 ? 2 : 1;

      if (time - lastSpawnRef.current > currentSpawnRate) {
        for (let s = 0; s < spawnCount; s++) {
          spawnEnemy(canvas.width, canvas.height);
        }

        lastSpawnRef.current = time;
      }

      if (
        scoreRef.current > ARC_SPIKE_START_SCORE &&
        time - lastArcSpikeRef.current > ARC_SPIKE_COOLDOWN
      ) {
        spawnArcSpikeWave(canvas.width, canvas.height, time);
        lastArcSpikeRef.current = time;
      }

      if (
        scoreRef.current > SHOCKWAVE_START_SCORE &&
        time - lastShockwaveRef.current > SHOCKWAVE_COOLDOWN
      ) {
        spawnCommitteeShockwave(canvas.width, canvas.height, time);
        lastShockwaveRef.current = time;
      }

      if (
        scoreRef.current > DEADLINE_WALL_START_SCORE &&
        time - lastDeadlineWallRef.current > DEADLINE_WALL_COOLDOWN
      ) {
        spawnDeadlineWall(canvas.width, canvas.height);
        lastDeadlineWallRef.current = time;
      }

      const enemies = enemiesRef.current;
      const particles = particlesRef.current;
      const shockwaves = shockwavesRef.current;
      let isGameOver = false;

      for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];

        if (enemy.type === 'homing') {
          const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);

          enemy.vx += Math.cos(angle) * 0.11;
          enemy.vy += Math.sin(angle) * 0.11;

          const currentSpeed = Math.hypot(enemy.vx, enemy.vy);
          const maxHomingSpeed = 5.0;

          if (currentSpeed > maxHomingSpeed) {
            enemy.vx = (enemy.vx / currentSpeed) * maxHomingSpeed;
            enemy.vy = (enemy.vy / currentSpeed) * maxHomingSpeed;
          }
        } else if (enemy.type === 'burst') {
          enemy.vx *= 0.985;
          enemy.vy *= 0.985;
          enemy.radius = 14 + Math.sin(time / 100) * 3;
          enemy.lifeTimer! -= 1;

          if (enemy.lifeTimer! <= 0) {
            createExplosion(enemy.x, enemy.y, enemy.color, 10);

            const currentChildren = countEnemiesByType('child');
            const allowedChildren = Math.max(0, MAX_CHILDREN - currentChildren);
            const childrenToCreate = Math.min(
              BURST_CHILD_COUNT,
              allowedChildren,
            );

            for (let j = 0; j < childrenToCreate; j++) {
              if (enemies.length >= MAX_ENEMIES) break;

              const angle = ((Math.PI * 2) / childrenToCreate) * j;

              enemies.push({
                x: enemy.x,
                y: enemy.y,
                vx: Math.cos(angle) * 5,
                vy: Math.sin(angle) * 5,
                radius: 5,
                color: '#f472b6',
                type: 'child',
                angle,
              });
            }

            enemies.splice(i, 1);
            continue;
          }
        } else if (enemy.type === 'dash') {
          enemy.timer! += 1;

          if (enemy.timer! % 75 === 0) {
            const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);

            enemy.vx = Math.cos(angle) * 14.5;
            enemy.vy = Math.sin(angle) * 14.5;
            enemy.angle = angle;

            createExplosion(enemy.x, enemy.y, enemy.color, 5);
          } else if (enemy.timer! % 75 > 12) {
            enemy.vx *= 0.84;
            enemy.vy *= 0.84;
          }
        } else if (enemy.type === 'zigzag') {
          enemy.phase! += 0.18;

          const speed = Math.hypot(enemy.baseVx!, enemy.baseVy!);

          if (speed > 0) {
            const normalX = -enemy.baseVy! / speed;
            const normalY = enemy.baseVx! / speed;
            const zigzagAmount = Math.sin(enemy.phase!) * 4.8;

            enemy.vx = enemy.baseVx! + normalX * zigzagAmount;
            enemy.vy = enemy.baseVy! + normalY * zigzagAmount;
          }
        } else if (enemy.type === 'spike') {
          enemy.timer = (enemy.timer ?? 0) + 1;

          const baseSpeed = Math.hypot(
            enemy.baseVx ?? enemy.vx,
            enemy.baseVy ?? enemy.vy,
          );
          const baseAngle = Math.atan2(
            enemy.baseVy ?? enemy.vy,
            enemy.baseVx ?? enemy.vx,
          );

          const wobble = Math.sin(enemy.timer * 0.16) * 0.04;
          const newAngle = baseAngle + wobble;

          enemy.vx = Math.cos(newAngle) * baseSpeed;
          enemy.vy = Math.sin(newAngle) * baseSpeed;
          enemy.angle = newAngle;
        }

        enemy.x += enemy.vx;
        enemy.y += enemy.vy;

        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const collisionRadius =
          enemy.type === 'spike' ? enemy.radius + 3 : enemy.radius;

        if (distance < player.radius + collisionRadius - 2) {
          isGameOver = handlePlayerHit(time);
          if (isGameOver) break;
        }

        if (
          enemy.x < -180 ||
          enemy.x > canvas.width + 180 ||
          enemy.y < -180 ||
          enemy.y > canvas.height + 180
        ) {
          enemies.splice(i, 1);
        }
      }

      if (!isGameOver) {
        for (let i = shockwaves.length - 1; i >= 0; i--) {
          const shockwave = shockwaves[i];

          if (time >= shockwave.warningUntil) {
            shockwave.radius += shockwave.speed * (deltaTime / 16.67);

            const dx = player.x - shockwave.x;
            const dy = player.y - shockwave.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const ringDistance = Math.abs(distance - shockwave.radius);
            const playerAngle = Math.atan2(dy, dx);

            const isOnSpike = isShockwaveAngleDangerous(
              playerAngle,
              shockwave,
              player.radius,
            );

            const isInsideSpikeBand =
              ringDistance < player.radius + SHOCKWAVE_OUTER_OFFSET;

            if (isOnSpike && isInsideSpikeBand) {
              isGameOver = handlePlayerHit(time);
              if (isGameOver) break;
            }

            if (shockwave.radius > shockwave.maxRadius) {
              shockwaves.splice(i, 1);
            }
          }
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];

        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life++;

        if (particle.life >= particle.maxLife) {
          particles.splice(i, 1);
        }
      }

      if (isGameOver) {
        setGameState('GAMEOVER');

        const finalScore = Number(scoreRef.current.toFixed(2));
        setScore(finalScore);

        if (finalScore > highScore) {
          setHighScore(finalScore);
          window.localStorage.setItem(HIGH_SCORE_KEY, finalScore.toString());
        }
      } else {
        scoreRef.current += deltaTime / 1000;

        if (time - lastUIUpdateRef.current > 50) {
          setScore(scoreRef.current);
          lastUIUpdateRef.current = time;
        }
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;

      const gridOffset = (time / 50) % 40;

      ctx.beginPath();

      for (let i = 0; i < canvas.width + 40; i += 40) {
        ctx.moveTo(i - gridOffset, 0);
        ctx.lineTo(i - gridOffset, canvas.height);
      }

      for (let j = 0; j < canvas.height + 40; j += 40) {
        ctx.moveTo(0, j - gridOffset);
        ctx.lineTo(canvas.width, j - gridOffset);
      }

      ctx.stroke();

      shockwaves.forEach((shockwave) => {
        drawShockwave(ctx, shockwave, time);
      });

      player.history.forEach((position, index) => {
        const alpha = 1 - index / player.history.length;

        ctx.beginPath();
        ctx.arc(
          position.x,
          position.y,
          player.radius * alpha,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = `rgba(56, 189, 248, ${alpha * 0.45})`;
        ctx.fill();
        ctx.closePath();
      });

      particles.forEach((particle) => {
        const alpha = 1 - particle.life / particle.maxLife;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = alpha * 0.85;
        ctx.fill();
        ctx.closePath();
      });

      ctx.globalAlpha = 1;

      enemies.forEach((enemy) => {
        if (enemy.type === 'spike') {
          drawSpike(ctx, enemy);
          return;
        }

        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
        ctx.fillStyle = enemy.color;

        ctx.shadowBlur =
          enemy.type === 'burst' ||
          enemy.type === 'dash' ||
          enemy.type === 'wall'
            ? 16
            : 9;
        ctx.shadowColor = enemy.color;

        ctx.fill();

        if (enemy.type === 'homing') {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, enemy.radius / 2.8, 0, Math.PI * 2);
          ctx.fill();
        } else if (enemy.type === 'dash') {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(
            enemy.x,
            enemy.y,
            enemy.radius *
              0.45 *
              Math.abs(Math.sin((enemy.timer || 0) / 5)),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        } else if (enemy.type === 'wall') {
          ctx.fillStyle = '#fecaca';
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, enemy.radius * 0.42, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.closePath();
      });

      ctx.shadowBlur = 0;

      if (!isGameOver) {
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = player.color;
        ctx.fill();
        ctx.closePath();

        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.closePath();
      }

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (!isGameOver) {
        animationFrameId.current = requestAnimationFrame(gameLoop);
      }
    };

    if (gameState === 'PLAYING') {
      animationFrameId.current = requestAnimationFrame(gameLoop);
    }

    return () => {
      cancelAnimationFrame(animationFrameId.current);
    };
  }, [gameState, highScore]);

  useEffect(() => {
    const movementKeys = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'w',
      'a',
      's',
      'd',
      'W',
      'A',
      'S',
      'D',
    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (movementKeys.includes(event.key)) {
        event.preventDefault();
      }

      if (
        (event.key === ' ' || event.key === 'Enter') &&
        gameState !== 'PLAYING'
      ) {
        event.preventDefault();
        initGame();
        return;
      }

      if ((event.key === 'r' || event.key === 'R') && gameState === 'GAMEOVER') {
        initGame();
        return;
      }

      keysRef.current[event.key] = true;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (movementKeys.includes(event.key)) {
        event.preventDefault();
      }

      keysRef.current[event.key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  const isNewRecord = gameState === 'GAMEOVER' && score >= highScore && score > 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 font-sans">
      <div className="mb-4 text-center">
        <h1 className="mb-2 bg-gradient-to-r from-sky-400 to-purple-500 bg-clip-text text-4xl font-black tracking-widest text-transparent drop-shadow-[0_0_10px_rgba(56,189,248,0.5)]">
          PhDodge <span className="text-xl">NEON</span>
        </h1>

        <p className="text-sm text-slate-400">
          Reviewer 2: Survival Mode
        </p>

        <p className="mt-2 text-sm text-slate-400">
          Move with{' '}
          <kbd className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-sky-400">
            W
          </kbd>{' '}
          <kbd className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-sky-400">
            A
          </kbd>{' '}
          <kbd className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-sky-400">
            S
          </kbd>{' '}
          <kbd className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-sky-400">
            D
          </kbd>{' '}
          or arrow keys
        </p>
      </div>

      <div className="relative overflow-hidden rounded-xl border-2 border-slate-800/50 bg-slate-900 shadow-[0_0_40px_rgba(56,189,248,0.15)]">
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          className="block h-auto w-full max-w-[800px] cursor-crosshair"
        />

        {gameState === 'START' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/80 p-6 text-white backdrop-blur-sm">
            <h2 className="mb-8 text-3xl font-bold text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]">
              Reviewer 2 Has Entered the Arena
            </h2>

            <ul className="mb-8 space-y-2 text-center text-sm text-slate-300">
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
                Red: Deadline
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]" />
                Purple: Reviewer 2
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-full bg-orange-400 shadow-[0_0_8px_#fb923c]" />
                Orange: Advisor Tracking Mode
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-full bg-yellow-400 shadow-[0_0_8px_#eab308]" />
                Yellow: Sudden Email
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
                Green: Nonlinear Dynamics
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1]" />
                Indigo: Thesis Committee
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-full bg-cyan-300 shadow-[0_0_8px_#67e8f9]" />
                Cyan: Arc Spike Wave
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-full bg-white shadow-[0_0_8px_#f8fafc]" />
                White: Committee Shockwave
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]" />
                Crimson: Deadline Wall
              </li>
            </ul>

            <button
              onClick={initGame}
              className="rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 px-10 py-3 text-xl font-bold text-white shadow-[0_0_20px_rgba(56,189,248,0.4)] transition-all hover:scale-105 hover:from-sky-400 hover:to-indigo-400 active:scale-95"
            >
              Start Suffering
            </button>

            <p className="mt-4 text-xs text-slate-500">
              Press Space or Enter to start.
            </p>
          </div>
        )}

        {gameState === 'PLAYING' && (
          <div className="pointer-events-none absolute right-6 top-4 z-10 flex flex-col items-end gap-2">
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-4 py-2 font-mono text-xl font-black text-sky-400 backdrop-blur-md drop-shadow-[0_0_5px_rgba(56,189,248,0.8)]">
              {score.toFixed(2)} s
            </div>

            {highScore > 0 && (
              <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-3 py-1 font-mono text-sm font-bold text-yellow-400 backdrop-blur-md drop-shadow-[0_0_5px_rgba(250,204,21,0.6)] transition-all">
                Best: {highScore.toFixed(2)} s
              </div>
            )}

            {IS_INVINCIBLE_MODE && (
              <div className="rounded-lg border border-emerald-400/50 bg-emerald-950/60 px-3 py-1 font-mono text-sm font-bold text-emerald-300 backdrop-blur-md drop-shadow-[0_0_5px_rgba(52,211,153,0.7)]">
                INVINCIBLE DEBUG
              </div>
            )}
          </div>
        )}

        {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-white backdrop-blur-md">
            <h2 className="mb-4 text-6xl font-black tracking-widest text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.8)]">
              YOU DIED
            </h2>

            <p className="mb-4 text-xl font-medium text-slate-300">
              Survival Time:
              <span className="mx-2 font-mono text-4xl font-bold text-sky-400 drop-shadow-[0_0_10px_rgba(56,189,248,0.6)]">
                {score.toFixed(2)}
              </span>
              seconds
            </p>

            {isNewRecord && (
              <p className="mb-8 animate-pulse text-lg font-bold text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]">
                New personal best. Reviewer 2 is mildly disappointed.
              </p>
            )}

            <button
              onClick={initGame}
              className={`rounded-full border-2 border-rose-500 bg-transparent px-10 py-3 text-xl font-bold text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)] transition-all hover:scale-105 hover:bg-rose-500 hover:text-white hover:shadow-[0_0_25px_rgba(244,63,94,0.6)] active:scale-95 ${
                !isNewRecord ? 'mt-4' : ''
              }`}
            >
              Try Again
            </button>

            <p className="mt-4 text-xs text-slate-500">
              Press R, Space, or Enter to restart.
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 max-w-[800px] text-center font-mono text-xs text-slate-600">
        Made by cc · Just for uu&apos;s little procrastination breaks. Enjoy!
      </div>
    </div>
  );
}