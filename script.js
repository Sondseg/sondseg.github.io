// SECTION: Simulation + Visualization for Autonomous Prediction Market Trader

// SECTION: Utility helpers
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Generates noise with some smoothness
function smoothNoise(prev, intensity) {
  const raw = prev + (Math.random() - 0.5) * intensity;
  return clamp(raw, -1, 1);
}

// SECTION: Simulation
function generateSimulation({ length = 400 } = {}) {
  const points = [];
  const newsEvents = [];

  let prob = 0.5;
  let drift = 0.0;
  let noise = 0.0;

  const timeMax = 100;
  const dt = timeMax / (length - 1);

  // Pre-generate a few larger "regime" changes in drift to create structure
  const regimeTimes = [20, 45, 70];
  const regimeEffects = [0.02, -0.03, 0.025];

  for (let i = 0; i < length; i++) {
    const t = i * dt;

    // Occasionally adjust drift when crossing regime times
    for (let r = 0; r < regimeTimes.length; r++) {
      if (Math.abs(t - regimeTimes[r]) < dt / 2) {
        drift += regimeEffects[r];
      }
    }

    // Evolve noise and probability
    noise = smoothNoise(noise, 0.35);
    const stepChange = drift * 0.04 + noise * 0.02;
    const prevProb = prob;
    prob = clamp(prob + stepChange, 0.04, 0.96);

    // Momentum as discrete derivative of probability
    const momentum = i === 0 ? 0 : (prob - points[i - 1].prob) / dt;

    // We'll compute z-score like metric later after we know global stats
    const point = {
      index: i,
      t,
      prob,
      momentum,
      rawChange: prob - prevProb,
    };

    points.push(point);
  }

  // Compute momentum statistics (mean & standard deviation)
  const momenta = points.map((p) => p.momentum);
  const mean = momenta.reduce((s, m) => s + m, 0) / momenta.length;
  const variance =
    momenta.reduce((s, m) => s + (m - mean) * (m - mean), 0) / momenta.length;
  const std = Math.sqrt(variance) || 1e-6;

  // Define a base threshold for signal vs noise
  const zThreshold = 1.3; // ~1.3 std deviations

  // Generate news events aligned with high |z| scores
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const z = (p.momentum - mean) / std;
    const absZ = Math.abs(z);

    // decide if this is a structural move or minor
    if (absZ > zThreshold && Math.random() < 0.5) {
      const relevance = clamp(0.4 + (absZ - zThreshold) * 0.4 + Math.random() * 0.2, 0, 1);
      const polarity = z > 0 ? "positive" : "negative";

      newsEvents.push({
        t: p.t,
        index: p.index,
        relevance,
        polarity,
        headline: generateHeadline(polarity),
      });
    }
  }

  // Map momentum to z-scores and construct combined signal + agent decisions
  const decisions = [];
  let positionSize = 0; // 0 → 1
  const maxPosition = 1.0;
  const riskBudget = 1.0;

  // Keep a pointer into newsEvents while iterating
  let newsIdx = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const z = (p.momentum - mean) / std;
    const absZ = Math.abs(z);

    // find nearest/most recent news event relative to this time
    while (newsIdx < newsEvents.length - 1 && newsEvents[newsIdx + 1].t <= p.t) {
      newsIdx++;
    }

    const news = newsEvents[newsIdx];
    const hasRecentNews = news && Math.abs(news.t - p.t) < 6; // time window
    const newsRelevance = hasRecentNews ? news.relevance : 0;
    const newsPolarity = hasRecentNews ? news.polarity : "neutral";

    // Combined signal score: mix of |z| and news relevance
    const momentumComponent = clamp((absZ - 0.4) / 2.4, 0, 1);
    const signalScore = clamp(
      0.6 * momentumComponent + 0.4 * newsRelevance,
      0,
      1
    );

    const tradeThreshold = 0.35;
    const highConviction = 0.7;

    let decision = "observe";

    if (signalScore > tradeThreshold) {
      if (positionSize === 0) {
        decision = "enter";
      } else if (signalScore > highConviction && positionSize < maxPosition) {
        decision = "scale";
      } else {
        decision = "hold";
      }
    }

    // risk-aware exit: if signalScore below threshold and we have risk on
    if (signalScore < tradeThreshold * 0.6 && positionSize > 0) {
      decision = "exit";
    }

    // update position size based on decision and direction sign
    const direction = z >= 0 ? 1 : -1; // simplified long/short
    const deltaPositionBase = signalScore * 0.35;

    if (decision === "enter") {
      positionSize = clamp(positionSize + deltaPositionBase * direction, -maxPosition, maxPosition);
    } else if (decision === "scale") {
      positionSize = clamp(positionSize + deltaPositionBase * 0.7 * direction, -maxPosition, maxPosition);
    } else if (decision === "hold") {
      // small decay toward 0
      positionSize = positionSize * 0.995;
    } else if (decision === "exit") {
      positionSize = positionSize * 0.3;
    }

    const riskUtilization = Math.round(
      (Math.abs(positionSize) / (maxPosition * riskBudget)) * 100
    );

    const enriched = {
      ...p,
      z,
      absZ,
      newsRelevance,
      newsPolarity,
      signalScore,
      tradeThreshold,
      positionSize,
      riskUtilization,
      decision,
    };

    points[i] = enriched;

    // capture material decisions to display in log
    if (decision !== "observe") {
      decisions.push({
        t: p.t,
        index: p.index,
        prob: p.prob,
        decision,
        signalScore,
        newsRelevance,
        momentum: p.momentum,
        positionSize,
      });
    }
  }

  return { points, newsEvents, decisions };
}

// Simple template headlines
function generateHeadline(polarity) {
  const positive = [
    "Polls tighten in favor of outcome",
    "Key indicator surprises to the upside",
    "Major fund signals confidence in scenario",
    "Market liquidity spikes as buyers step in",
  ];

  const negative = [
    "Unexpected data undermines prior consensus",
    "Key stakeholder walks back earlier commitment",
    "Liquidity thins out as traders de-risk",
    "New report challenges baseline assumptions",
  ];

  const pool = polarity === "positive" ? positive : negative;
  return pool[Math.floor(Math.random() * pool.length)];
}

// SECTION: Chart setup
/**
 * Chart.js is loaded from a CDN in index.html and exposed globally as Chart.
 * We declare it here for the linter/validator.
 */
/* global Chart */

let probChart;
let momentumChart;
let signalChart;

// Data references
let simData = generateSimulation();
let currentIndex = 0;
let playing = false;
let playbackSpeed = 1; // multiplier
let lastFrameTime = 0;

function createCharts() {
  const probCtx = document.getElementById("prob-chart");
  const momentumCtx = document.getElementById("momentum-chart");
  const signalCtx = document.getElementById("signal-chart");

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    interaction: {
      intersect: false,
      mode: "index",
    },
    scales: {
      x: {
        type: "linear",
        ticks: {
          color: "#6f7593",
          font: { size: 10 },
        },
        grid: {
          color: "rgba(255,255,255,0.06)",
        },
      },
      y: {
        ticks: {
          color: "#6f7593",
          font: { size: 10 },
        },
        grid: {
          color: "rgba(255,255,255,0.06)",
        },
      },
    },
  };

  // Probability + position chart
  probChart = new Chart(probCtx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Probability",
          data: [],
          parsing: false,
          borderColor: "#8cb3ff",
          borderWidth: 2,
          tension: 0.25,
        },
        {
          label: "Position size",
          data: [],
          parsing: false,
          borderColor: "#ffd36a",
          borderWidth: 1.5,
          borderDash: [6, 4],
          tension: 0.15,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales.y,
          min: 0,
          max: 1,
        },
        y1: {
          position: "right",
          min: -1,
          max: 1,
          ticks: {
            display: false,
          },
          grid: {
            display: false,
          },
        },
      },
    },
  });

  // Momentum chart
  momentumChart = new Chart(momentumCtx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Momentum",
          data: [],
          parsing: false,
          borderColor: "#ff8ec7",
          borderWidth: 1.6,
          tension: 0.2,
        },
        {
          label: "Signal threshold",
          data: [],
          parsing: false,
          borderColor: "#f88a7c",
          borderWidth: 1,
          borderDash: [4, 4],
        },
        {
          label: "-Signal threshold",
          data: [],
          parsing: false,
          borderColor: "#f88a7c",
          borderWidth: 1,
          borderDash: [4, 4],
        },
      ],
    },
    options: {
      ...baseOptions,
    },
  });

  // Signal vs threshold chart
  signalChart = new Chart(signalCtx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Signal score",
          data: [],
          parsing: false,
          borderColor: "#7bffb0",
          borderWidth: 1.6,
          tension: 0.2,
        },
        {
          label: "Threshold",
          data: [],
          parsing: false,
          borderColor: "#f88a7c",
          borderWidth: 1,
          borderDash: [4, 4],
        },
      ],
    },
    options: {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales.y,
          min: 0,
          max: 1,
        },
      },
    },
  });
}

// SECTION: Rendering
function updateVisuals(index) {
  const slice = simData.points.slice(0, index + 1);
  if (!slice.length) return;

  const last = slice[slice.length - 1];

  // Update charts
  probChart.data.datasets[0].data = slice.map((p) => ({ x: p.t, y: p.prob }));
  probChart.data.datasets[1].data = slice.map((p) => ({ x: p.t, y: p.positionSize }));

  const momentumThreshold = simData.points[0].tradeThreshold || 0.35; // use same, scaled later
  const momentumScale = simData.points.reduce((max, p) => Math.max(max, Math.abs(p.momentum)), 0.0001);
  const momThreshValue = momentumThreshold * (momentumScale / 1.0);

  momentumChart.data.datasets[0].data = slice.map((p) => ({ x: p.t, y: p.momentum }));
  momentumChart.data.datasets[1].data = slice.map((p) => ({ x: p.t, y: momThreshValue }));
  momentumChart.data.datasets[2].data = slice.map((p) => ({ x: p.t, y: -momThreshValue }));

  signalChart.data.datasets[0].data = slice.map((p) => ({ x: p.t, y: p.signalScore }));
  signalChart.data.datasets[1].data = slice.map((p) => ({ x: p.t, y: p.tradeThreshold }));

  probChart.update();
  momentumChart.update();
  signalChart.update();

  // Update agent state
  updateAgentState(last);

  // Update decision log and news feed
  renderDecisionLog(last.t);
  renderNewsFeed(last.t);
}

// Update the live state widgets
function updateAgentState(point) {
  const timeEl = document.getElementById("state-time");
  const probEl = document.getElementById("state-prob");
  const momEl = document.getElementById("state-momentum");
  const newsEl = document.getElementById("state-news");
  const signalEl = document.getElementById("state-signal");
  const posEl = document.getElementById("state-position");
  const riskEl = document.getElementById("state-risk");
  const modeEl = document.getElementById("state-mode");

  timeEl.textContent = point.t.toFixed(1);
  probEl.textContent = point.prob.toFixed(2);
  momEl.textContent = point.momentum.toFixed(3);
  newsEl.textContent = point.newsRelevance.toFixed(2);
  signalEl.textContent = point.signalScore.toFixed(2);
  posEl.textContent = point.positionSize.toFixed(2);
  riskEl.textContent = `${point.riskUtilization}%`;

  let modeLabel = "Idle / observing";
  if (point.decision === "enter") modeLabel = "Entering position";
  else if (point.decision === "scale") modeLabel = "Scaling position";
  else if (point.decision === "hold") modeLabel = "Holding risk";
  else if (point.decision === "exit") modeLabel = "Exiting / de-risking";

  modeEl.textContent = modeLabel;
}

// Decision log rendering near current time
function renderDecisionLog(currentTime) {
  const container = document.getElementById("decision-log");

  const windowSize = 40;
  const decisions = simData.decisions.filter(
    (d) => d.t >= currentTime - windowSize && d.t <= currentTime
  );

  container.innerHTML = "";

  decisions.forEach((d) => {
    const item = document.createElement("article");
    item.className = "decision-item";

    const timeEl = document.createElement("div");
    timeEl.className = "decision-item__time";
    timeEl.textContent = `t = ${d.t.toFixed(1)}`;

    const modeEl = document.createElement("div");
    modeEl.className = `decision-item__mode decision-item__mode--${mapDecisionClass(
      d.decision
    )}`;
    modeEl.textContent = formatDecisionLabel(d.decision);

    const badgeEl = document.createElement("div");
    badgeEl.className = "decision-item__badge";
    badgeEl.textContent = `Signal ${d.signalScore.toFixed(2)} · P=${d.prob
      .toFixed(2)
      .toString()}`;

    const detailEl = document.createElement("p");
    detailEl.className = "decision-item__detail";
    detailEl.textContent = describeDecision(d);

    item.appendChild(timeEl);
    item.appendChild(modeEl);
    item.appendChild(badgeEl);
    item.appendChild(detailEl);

    container.appendChild(item);
  });
}

function mapDecisionClass(decision) {
  if (decision === "enter") return "entry";
  if (decision === "scale") return "scale";
  if (decision === "hold") return "hold";
  if (decision === "exit") return "exit";
  return "hold";
}

function formatDecisionLabel(decision) {
  switch (decision) {
    case "enter":
      return "Entry";
    case "scale":
      return "Scale";
    case "hold":
      return "Hold";
    case "exit":
      return "Exit";
    default:
      return "Observe";
  }
}

function describeDecision(d) {
  const direction = d.momentum >= 0 ? "long" : "short";
  const pieces = [];

  if (d.decision === "enter") {
    pieces.push(`Opening ${direction} position`);
  } else if (d.decision === "scale") {
    pieces.push(`Adding to ${direction} position`);
  } else if (d.decision === "hold") {
    pieces.push("Maintaining exposure");
  } else if (d.decision === "exit") {
    pieces.push("Reducing or closing exposure");
  }

  pieces.push(`dP/dt = ${d.momentum.toFixed(3)}`);

  if (d.newsRelevance > 0.25) {
    pieces.push(`news relevance = ${d.newsRelevance.toFixed(2)}`);
  }

  pieces.push(`position = ${d.positionSize.toFixed(2)}`);

  return pieces.join(" · ");
}

// News feed rendering near current time
function renderNewsFeed(currentTime) {
  const container = document.getElementById("news-feed");
  const windowSize = 50;
  const items = simData.newsEvents.filter(
    (n) => n.t >= currentTime - windowSize && n.t <= currentTime
  );

  container.innerHTML = "";

  items.forEach((n) => {
    const item = document.createElement("article");
    item.className = "news-item";

    const timeEl = document.createElement("div");
    timeEl.className = "news-item__time";
    timeEl.textContent = `t = ${n.t.toFixed(1)}`;

    const scoreEl = document.createElement("div");
    scoreEl.className = "news-item__score";
    scoreEl.textContent = `Relevance ${n.relevance.toFixed(2)}`;

    const headlineEl = document.createElement("p");
    headlineEl.className = "news-item__headline";
    headlineEl.textContent = n.headline;

    const tagsEl = document.createElement("div");
    tagsEl.className = "news-item__tags";

    const impactChip = document.createElement("span");
    const impact =
      n.relevance > 0.7 ? "high" : n.relevance > 0.45 ? "medium" : "low";
    impactChip.className = `chip chip--${impact}`;
    impactChip.textContent = `${impact.charAt(0).toUpperCase()}${impact.slice(
      1
    )} impact`;

    const polarityChip = document.createElement("span");
    polarityChip.className = `chip chip--${
      n.polarity === "positive" ? "pos" : "neg"
    }`;
    polarityChip.textContent =
      n.polarity === "positive" ? "Supports event" : "Challenges event";

    tagsEl.appendChild(impactChip);
    tagsEl.appendChild(polarityChip);

    item.appendChild(timeEl);
    item.appendChild(scoreEl);
    item.appendChild(headlineEl);
    item.appendChild(tagsEl);

    container.appendChild(item);
  });
}

// SECTION: Playback loop
function stepSimulation(timestamp) {
  if (!playing) return;

  if (!lastFrameTime) lastFrameTime = timestamp;
  const deltaMs = timestamp - lastFrameTime;
  const baseStepMs = 120; // base speed

  if (deltaMs >= baseStepMs / playbackSpeed) {
    lastFrameTime = timestamp;

    currentIndex += 1;
    if (currentIndex >= simData.points.length - 1) {
      currentIndex = simData.points.length - 1;
      playing = false;
      updatePlayButton();
      return;
    }

    updateVisuals(currentIndex);
  }

  requestAnimationFrame(stepSimulation);
}

function updatePlayButton() {
  const btn = document.getElementById("play-toggle");
  btn.textContent = playing ? "Pause" : "Play";
}

// Reset the simulation and visuals
function resetSimulation() {
  simData = generateSimulation();
  currentIndex = 0;
  lastFrameTime = 0;
  playing = false;
  updatePlayButton();
  updateVisuals(currentIndex);
}

// SECTION: Event Handlers
window.addEventListener("DOMContentLoaded", () => {
  createCharts();
  updateVisuals(currentIndex);

  const playBtn = document.getElementById("play-toggle");
  const resetBtn = document.getElementById("reset-btn");
  const speedSelect = document.getElementById("speed-select");

  playBtn.addEventListener("click", () => {
    playing = !playing;
    updatePlayButton();
    if (playing) {
      lastFrameTime = 0;
      requestAnimationFrame(stepSimulation);
    }
  });

  resetBtn.addEventListener("click", () => {
    resetSimulation();
  });

  speedSelect.addEventListener("change", (e) => {
    const value = parseFloat(e.target.value);
    playbackSpeed = isNaN(value) ? 1 : value;
  });
});
