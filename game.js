"use strict";

const W = 540;
const H = 900;
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const setupPanel = document.getElementById("setup-panel");
const racePanel = document.getElementById("race-panel");
const resultPanel = document.getElementById("result-panel");
const boostButton = document.getElementById("boost-button");
const soundButton = document.getElementById("sound-button");
const streakValue = document.getElementById("streak-value");
const resultCopy = document.getElementById("result-copy");

const INFO = {
  red: { label: "RED", color: "#ff3b5f", glow: "rgba(255,59,95,.8)" },
  cyan: { label: "CYAN", color: "#29e7ff", glow: "rgba(41,231,255,.8)" },
  yellow: { label: "YELLOW", color: "#ffd84a", glow: "rgba(255,216,74,.8)" },
};

const walls = [
  [48, 210, 205, 252], [492, 210, 335, 252],
  [75, 390, 185, 422], [465, 390, 355, 422],
  [48, 700, 180, 735], [492, 700, 360, 735],
];
const pegs = [
  [118, 305], [210, 296], [300, 316], [410, 298],
  [164, 352], [260, 356], [360, 350],
  [108, 470], [210, 462], [320, 476], [424, 462],
  [160, 514], [270, 520], [382, 510],
];

let selected = "cyan";
let balls = makeBalls();
let particles = [];
let spinners = makeSpinners();
let running = false;
let winnerId = null;
let boostUsed = false;
let round = 1;
let startedAt = 0;
let lastFrame = performance.now();
let soundEnabled = true;
let audioContext = null;
let lastSoundAt = 0;
let streak = readNumber("gravityLabStreak");
let bestStreak = readNumber("gravityLabBestStreak");
streakValue.textContent = String(streak);

function readNumber(key) {
  try { return Number.parseInt(localStorage.getItem(key) || "0", 10) || 0; }
  catch { return 0; }
}

function saveProgress() {
  try {
    localStorage.setItem("gravityLabStreak", String(streak));
    localStorage.setItem("gravityLabBestStreak", String(bestStreak));
  } catch { /* Storage is optional. */ }
}

function makeBalls() {
  return [["red", 150], ["cyan", 270], ["yellow", 390]].map(([id, x]) => ({
    id, ...INFO[id], x, y: 105 + Math.random() * 4,
    vx: (Math.random() - .5) * 16, vy: 0, r: 18,
    finished: false, trail: [],
  }));
}

function makeSpinners() {
  return [
    { x: 270, y: 586, length: 190, angle: .2, speed: 2.15, color: "#b65cff" },
    { x: 270, y: 670, length: 155, angle: 1.1, speed: -2.7, color: "#ff477e" },
  ];
}

function nearest(ax, ay, bx, by, x, y) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return { x: ax + dx * t, y: ay + dy * t };
}

function ping(frequency = 250, volume = .018) {
  if (!soundEnabled || performance.now() - lastSoundAt < 70) return;
  lastSoundAt = performance.now();
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * .62, audioContext.currentTime + .08);
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + .09);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + .1);
  } catch { /* Audio is optional. */ }
}

function burst(x, y, color, count = 6) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 120;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: .35 + Math.random() * .45,
      color,
    });
  }
}

function collideCircle(ball, cx, cy, radius, kick = 0) {
  let dx = ball.x - cx;
  let dy = ball.y - cy;
  let distance = Math.hypot(dx, dy);
  const minimum = ball.r + radius;
  if (distance >= minimum) return;
  if (distance < .01) { dx = .01; dy = -1; distance = 1; }
  const nx = dx / distance;
  const ny = dy / distance;
  ball.x += nx * (minimum - distance);
  ball.y += ny * (minimum - distance);
  const normalVelocity = ball.vx * nx + ball.vy * ny;
  if (normalVelocity < 0) {
    ball.vx -= 1.72 * normalVelocity * nx;
    ball.vy -= 1.72 * normalVelocity * ny;
    ball.vx += nx * kick;
    ball.vy += ny * kick;
    if (Math.abs(normalVelocity) > 80) {
      burst(ball.x, ball.y, ball.color, 4);
      ping(190 + Math.abs(normalVelocity) * .65);
    }
  }
}

function collideLine(ball, ax, ay, bx, by, thickness, spin = 0, centerX = 0, centerY = 0) {
  const point = nearest(ax, ay, bx, by, ball.x, ball.y);
  let dx = ball.x - point.x;
  let dy = ball.y - point.y;
  let distance = Math.hypot(dx, dy);
  const minimum = ball.r + thickness;
  if (distance >= minimum) return;
  if (distance < .01) { dx = 0; dy = -1; distance = 1; }
  const nx = dx / distance;
  const ny = dy / distance;
  ball.x += nx * (minimum - distance);
  ball.y += ny * (minimum - distance);
  const surfaceVX = spin ? -(point.y - centerY) * spin : 0;
  const surfaceVY = spin ? (point.x - centerX) * spin : 0;
  const normalVelocity = (ball.vx - surfaceVX) * nx + (ball.vy - surfaceVY) * ny;
  if (normalVelocity < 0) {
    ball.vx -= 1.62 * normalVelocity * nx;
    ball.vy -= 1.62 * normalVelocity * ny;
    ball.vx += surfaceVX * .32;
    ball.vy += surfaceVY * .32;
    if (Math.abs(normalVelocity) > 90) {
      burst(point.x, point.y, ball.color, 5);
      ping(220 + Math.abs(normalVelocity) * .6);
    }
  }
}

function finishBall(ball) {
  if (winnerId) return;
  ball.finished = true;
  ball.y = 844;
  ball.vx = 0;
  ball.vy = 0;
  winnerId = ball.id;
  burst(ball.x, ball.y, ball.color, 26);
  ping(650, .055);

  const won = selected === winnerId;
  if (won) {
    streak += 1;
    bestStreak = Math.max(bestStreak, streak);
  } else {
    streak = 0;
  }
  streakValue.textContent = String(streak);
  saveProgress();

  window.setTimeout(() => {
    running = false;
    racePanel.classList.add("hidden");
    resultPanel.classList.remove("hidden");
    resultCopy.innerHTML = won
      ? `<strong>YOU WON!</strong> Current streak: ${streak} · Best: ${bestStreak}`
      : `${INFO[winnerId].label} survived. <strong>Your streak was reset.</strong> Best: ${bestStreak}`;
  }, 1250);
}

function simulate(dt, elapsed) {
  for (let substep = 0; substep < 2; substep += 1) {
    const step = dt / 2;
    spinners.forEach(spinner => { spinner.angle += spinner.speed * step; });

    balls.forEach(ball => {
      if (ball.finished) return;
      ball.vy += (elapsed > 13 ? 740 : 540) * step;
      ball.vx *= .999;
      ball.vy *= .9995;
      ball.x += ball.vx * step;
      ball.y += ball.vy * step;

      if (ball.x < 48 + ball.r) { ball.x = 48 + ball.r; ball.vx = Math.abs(ball.vx) * .78; }
      if (ball.x > 492 - ball.r) { ball.x = 492 - ball.r; ball.vx = -Math.abs(ball.vx) * .78; }
      if (elapsed > 8 && Math.abs(ball.vx) < 22 && Math.abs(ball.vy) < 22) {
        ball.vx += (270 - ball.x) * .45 + (Math.random() - .5) * 90;
        ball.vy += 34;
      }

      walls.forEach(wall => collideLine(ball, wall[0], wall[1], wall[2], wall[3], 7));
      pegs.forEach(peg => collideCircle(ball, peg[0], peg[1], 10, 7));
      [[132, 785], [270, 770], [408, 785]].forEach(bumper => collideCircle(ball, bumper[0], bumper[1], 28, 70));
      spinners.forEach(spinner => {
        const dx = Math.cos(spinner.angle) * spinner.length / 2;
        const dy = Math.sin(spinner.angle) * spinner.length / 2;
        collideLine(ball, spinner.x - dx, spinner.y - dy, spinner.x + dx, spinner.y + dy, 9, spinner.speed, spinner.x, spinner.y);
      });

      if (ball.y >= 844) finishBall(ball);
    });

    if (elapsed > 15 && !winnerId) {
      const leader = [...balls].filter(ball => !ball.finished).sort((a, b) => b.y - a.y)[0];
      if (leader) finishBall(leader);
    }
  }

  particles.forEach(particle => {
    particle.life -= dt;
    particle.vy += 170 * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  });
  particles = particles.filter(particle => particle.life > 0);
  balls.forEach(ball => {
    if (!ball.finished) ball.trail.unshift({ x: ball.x, y: ball.y });
    ball.trail = ball.trail.slice(0, 9);
  });
}

function drawLine(ax, ay, bx, by, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function draw(elapsed) {
  const background = ctx.createLinearGradient(0, 0, 0, H);
  background.addColorStop(0, "#11142c");
  background.addColorStop(.48, "#080b1c");
  background.addColorStop(1, "#14091f");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  for (let x = 0; x <= W; x += 30) drawLine(x, 0, x, H, "rgba(89,111,255,.08)", 1);
  for (let y = 0; y <= H; y += 30) drawLine(0, y, W, y, "rgba(89,111,255,.08)", 1);
  const topGlow = ctx.createRadialGradient(270, 80, 0, 270, 80, 280);
  topGlow.addColorStop(0, "rgba(98,70,255,.24)");
  topGlow.addColorStop(1, "rgba(98,70,255,0)");
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, W, 350);

  ctx.textAlign = "center";
  ctx.font = "800 18px Arial";
  ctx.fillStyle = "#f1f2ff";
  ctx.fillText(running ? "USE YOUR BOOST WISELY" : winnerId ? "EXPERIMENT COMPLETE" : "CHOOSE YOUR CONTENDER", 270, 42);
  ctx.font = "700 11px Arial";
  ctx.fillStyle = "rgba(166,174,220,.72)";
  ctx.fillText(`GRAVITY LAB  •  TEST ${String(round).padStart(2, "0")}`, 270, 64);

  ctx.shadowBlur = 14;
  ctx.shadowColor = "rgba(107,91,255,.5)";
  drawLine(48, 88, 48, 844, "rgba(123,111,255,.8)", 3);
  drawLine(492, 88, 492, 844, "rgba(123,111,255,.8)", 3);
  ctx.shadowBlur = 0;

  walls.forEach(wall => {
    drawLine(wall[0], wall[1], wall[2], wall[3], "#5663aa", 15);
    drawLine(wall[0], wall[1] - 2, wall[2], wall[3] - 2, "rgba(210,216,255,.7)", 3);
  });
  pegs.forEach(([x, y]) => {
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#29e7ff";
    ctx.fillStyle = "#274970";
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6beaff"; ctx.lineWidth = 2; ctx.stroke();
  });
  ctx.shadowBlur = 0;

  spinners.forEach(spinner => {
    const dx = Math.cos(spinner.angle) * spinner.length / 2;
    const dy = Math.sin(spinner.angle) * spinner.length / 2;
    ctx.shadowBlur = 22;
    ctx.shadowColor = spinner.color;
    drawLine(spinner.x - dx, spinner.y - dy, spinner.x + dx, spinner.y + dy, spinner.color, 17);
    ctx.fillStyle = "#f4ecff";
    ctx.beginPath(); ctx.arc(spinner.x, spinner.y, 12, 0, Math.PI * 2); ctx.fill();
  });
  ctx.shadowBlur = 0;

  [[132, 785], [270, 770], [408, 785]].forEach(([x, y]) => {
    const pulse = 1 + Math.sin(elapsed * 7 + x) * .06;
    ctx.shadowBlur = 22;
    ctx.shadowColor = "#ff4f9a";
    ctx.fillStyle = "#68184f";
    ctx.beginPath(); ctx.arc(x, y, 29 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ff71b0"; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = "#ffcae1";
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
  });
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(138,255,193,.12)";
  ctx.fillRect(48, 828, 444, 32);
  ctx.setLineDash([12, 9]);
  drawLine(48, 835, 492, 835, "rgba(138,255,193,.75)", 2);
  ctx.setLineDash([]);
  ctx.font = "800 11px Arial";
  ctx.fillStyle = "#8affc1";
  ctx.fillText("FINISH", 270, 858);

  particles.forEach(particle => {
    ctx.globalAlpha = Math.max(0, particle.life * 1.8);
    ctx.fillStyle = particle.color;
    ctx.beginPath(); ctx.arc(particle.x, particle.y, 2.5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  balls.forEach(ball => {
    [...ball.trail].reverse().forEach((point, index) => {
      ctx.globalAlpha = (index + 1) / ball.trail.length * .28;
      ctx.fillStyle = ball.color;
      ctx.beginPath(); ctx.arc(point.x, point.y, 4 + index, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = selected === ball.id ? 32 : 22;
    ctx.shadowColor = ball.glow;
    const fill = ctx.createRadialGradient(ball.x - 6, ball.y - 7, 1, ball.x, ball.y, ball.r);
    fill.addColorStop(0, "#fff");
    fill.addColorStop(.25, ball.color);
    fill.addColorStop(1, "#11152d");
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = selected === ball.id ? "#fff" : ball.color;
    ctx.lineWidth = selected === ball.id ? 3 : 2;
    ctx.stroke();
  });
  ctx.shadowBlur = 0;

  if (running && boostUsed) {
    ctx.font = "900 13px Arial";
    ctx.fillStyle = "#ffd84a";
    ctx.fillText("BOOST DEPLOYED", 270, 885);
  }

  if (winnerId) drawWinner();
}

function drawWinner() {
  const info = INFO[winnerId];
  const won = selected === winnerId;
  ctx.fillStyle = "rgba(4,5,15,.76)";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(270, 430, 0, 270, 430, 250);
  glow.addColorStop(0, info.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 170, W, 520);
  ctx.beginPath();
  ctx.roundRect(70, 305, 400, 270, 34);
  ctx.fillStyle = "rgba(15,18,43,.96)";
  ctx.fill();
  ctx.strokeStyle = info.color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.shadowBlur = 36;
  ctx.shadowColor = info.color;
  ctx.fillStyle = info.color;
  ctx.beginPath(); ctx.arc(270, 385, 42, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.textAlign = "center";
  ctx.font = "900 24px Arial";
  ctx.fillStyle = "#fff";
  ctx.fillText("WINNER", 270, 470);
  ctx.font = "900 30px Arial";
  ctx.fillStyle = info.color;
  ctx.fillText(info.label, 270, 512);
  ctx.font = "700 14px Arial";
  ctx.fillStyle = won ? "#8affc1" : "#ff9cab";
  ctx.fillText(won ? `YOUR PICK WON — STREAK ${streak}` : "YOUR PICK DID NOT SURVIVE", 270, 548);
}

function startRace() {
  balls = makeBalls();
  particles = [];
  spinners = makeSpinners();
  spinners[0].angle = Math.random() * Math.PI;
  spinners[1].angle = Math.random() * Math.PI;
  winnerId = null;
  boostUsed = false;
  boostButton.classList.remove("used");
  boostButton.disabled = false;
  setupPanel.classList.add("hidden");
  resultPanel.classList.add("hidden");
  racePanel.classList.remove("hidden");
  running = true;
  startedAt = performance.now();
  lastFrame = performance.now();
  ping(520, .05);
}

function activateBoost() {
  if (!running || boostUsed || winnerId) return;
  const ball = balls.find(candidate => candidate.id === selected && !candidate.finished);
  if (!ball) return;
  boostUsed = true;
  boostButton.classList.add("used");
  boostButton.disabled = true;
  ball.vy += 310;
  ball.vx += (270 - ball.x) * .65;
  burst(ball.x, ball.y, "#ffd84a", 22);
  ping(760, .07);
}

function nextRound() {
  round += 1;
  winnerId = null;
  balls = makeBalls();
  particles = [];
  spinners = makeSpinners();
  resultPanel.classList.add("hidden");
  racePanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
}

document.querySelectorAll(".choice").forEach(button => {
  button.addEventListener("click", () => {
    selected = button.dataset.ball;
    document.querySelectorAll(".choice").forEach(choice => {
      const isSelected = choice === button;
      choice.classList.toggle("selected", isSelected);
      choice.setAttribute("aria-pressed", String(isSelected));
    });
    balls = makeBalls();
  });
});

document.getElementById("start-button").addEventListener("click", startRace);
document.getElementById("again-button").addEventListener("click", nextRound);
boostButton.addEventListener("click", activateBoost);
canvas.addEventListener("pointerdown", () => { if (running && !boostUsed) activateBoost(); });
soundButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundButton.textContent = soundEnabled ? "SOUND: ON" : "SOUND: OFF";
  soundButton.setAttribute("aria-label", soundEnabled ? "Turn sound off" : "Turn sound on");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && audioContext) audioContext.suspend().catch(() => {});
  if (!document.hidden && audioContext && soundEnabled) audioContext.resume().catch(() => {});
});

function loop(time) {
  const dt = Math.min(.025, Math.max(.001, (time - lastFrame) / 1000 || .016));
  lastFrame = time;
  const elapsed = running ? (time - startedAt) / 1000 : 0;
  if (running) simulate(dt, elapsed);
  draw(elapsed);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
