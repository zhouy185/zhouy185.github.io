// script.js
// Critical Path Method "fluid filling" visualization

// ----------------------
// Data model
// ----------------------

// Start with an empty activity set; user will add nodes manually or in batch
const baseActivities = [];

// Global DOM references
const svg = document.getElementById("cpmCanvas");
const timelineSvg = document.getElementById("timeline");
const startButton = document.getElementById("btn-start-sim");
const startBackwardButton = document.getElementById("btn-start-backward");
const resetButton = document.getElementById("btn-reset");
const timeDisplay = document.getElementById("time-display");
const speedSlider = document.getElementById("speed-slider");
const speedLabel = document.getElementById("speed-label");
const showCriticalButton = document.getElementById("btn-show-critical");
const pauseResumeButton = document.getElementById("btn-pause-resume");
const addNodeButton = document.getElementById("btn-add-node");
const inputNodeId = document.getElementById("input-node-id");
const inputDuration = document.getElementById("input-duration");
const inputPredecessors = document.getElementById("input-predecessors");
const inputBatchCount = document.getElementById("input-batch-count");
const addBatchButton = document.getElementById("btn-add-batch");
const addStartEndButton = document.getElementById("btn-add-start-end");
const contextMenu = document.getElementById("context-menu");
const addSuccessorButton = document.getElementById("btn-add-successor");
const addNewSuccessorButton = document.getElementById("btn-add-new-successor");
const editDurationButton = document.getElementById("btn-edit-duration");
const addPredecessorButton = document.getElementById("btn-add-predecessor");
const deleteNodeButton = document.getElementById("btn-delete-node");

// Activity map keyed by id
const activitiesMap = {};

// Simulation state
let currentTime = 0;
const timeStep = 0.1; // simulation time increment per frame
let speedMultiplier = 0.1; // Speed control multiplier (0.1x to 3x)
let running = false;
let runningBackward = false;
let activityStartEvents = []; // Track when activities start (one per activity)
let activityEndEvents = []; // Track when activities end (one per activity)
let paused = false; // Global pause state for both forward and backward
let backwardStartTime = null; // Anchor for backward pass display time

// Drag state
let draggedNode = null;
let dragOffset = { x: 0, y: 0 };
let contextSourceId = null;

// Canvas resize state
let resizingCanvas = false;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartWidth = 0;
let resizeStartHeight = 0;

// Predecessor draw mode
let predecessorDrawMode = null;  // null or sourceId when drawing
let cursorX = 0;
let cursorY = 0;

// Critical activities visibility
let showCriticalActivities = false;

// CPM results
let ES = {};
let EF = {};
let LS = {};
let LF = {};
let slack = {};
let projectDuration = 0;
let showProjectEnd = false; // show end marker on timeline when forward pass completes

// ----------------------
// Initialization helpers
// ----------------------

// Copy base activities into activitiesMap and initialize state
function initActivities() {
  Object.keys(activitiesMap).forEach(key => delete activitiesMap[key]);

  baseActivities.forEach(a => {
    activitiesMap[a.id] = {
      id: a.id,
      duration: a.duration,
      predecessors: [...a.predecessors],
      successors: [],
      // x, y are stored as relative positions in [0, 1]; actual pixel positions
      // will be computed when drawing based on current SVG size.
      xRel: a.x,
      yRel: a.y,
      state: "not_started", // "not_started" | "in_progress" | "completed"
      startTime: null,
      finishTime: null,
      progress: 0, // 0–1
    };
  });

  // Build successors list
  Object.values(activitiesMap).forEach(act => {
    act.predecessors.forEach(pid => {
      const pred = activitiesMap[pid];
      if (pred && !pred.successors.includes(act.id)) {
        pred.successors.push(act.id);
      }
    });
  });
}

// Find a non-overlapping position for a new node
function findNonOverlappingPosition(duration) {
  const minDistance = 0.15; // minimum distance between nodes
  const maxAttempts = 100;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Try positions in a spiral pattern
    const angle = attempt * 0.5;
    const radius = 0.1 + (attempt * 0.05);
    const xRel = 0.5 + Math.cos(angle) * radius;
    const yRel = 0.5 + Math.sin(angle) * radius;
    
    // Clamp to valid range
    const clampedX = Math.max(0.1, Math.min(0.9, xRel));
    const clampedY = Math.max(0.1, Math.min(0.9, yRel));
    
    // Check if this position overlaps with any existing node
    let overlaps = false;
    for (const act of Object.values(activitiesMap)) {
      const dx = act.xRel - clampedX;
      const dy = act.yRel - clampedY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < minDistance) {
        overlaps = true;
        break;
      }
    }
    
    if (!overlaps) {
      return { x: clampedX, y: clampedY };
    }
  }
  
  // Fallback: place at random position
  return { x: 0.5 + (Math.random() - 0.5) * 0.6, y: 0.5 + (Math.random() - 0.5) * 0.6 };
}

// Rebuild successors list after changes
function rebuildSuccessors() {
  Object.values(activitiesMap).forEach(act => {
    act.successors = [];
  });
  
  Object.values(activitiesMap).forEach(act => {
    act.predecessors.forEach(pid => {
      const pred = activitiesMap[pid];
      if (pred && !pred.successors.includes(act.id)) {
        pred.successors.push(act.id);
      }
    });
  });
}

function generateUniqueId() {
  let counter = 0;
  while (true) {
    const id = numToLetters(counter);
    if (!activitiesMap[id]) return id;
    counter += 1;
  }
}

function numToLetters(num) {
  let result = '';
  while (num >= 0) {
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26) - 1;
  }
  return result;
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.style.display = "none";
  }
  contextSourceId = null;
}

function showContextMenu(act, x, y) {
  if (!contextMenu || running) return;
  contextSourceId = act.id;
  contextMenu.style.display = "block";
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
}

function startPredecessorDraw(sourceId) {
  if (!activitiesMap[sourceId]) return;
  predecessorDrawMode = sourceId;
  hideContextMenu();
}

function cancelPredecessorDraw() {
  predecessorDrawMode = null;
  drawStaticNetwork();  // Redraw without the preview line
}

function completePredecessorDraw(targetId) {
  if (!predecessorDrawMode || !activitiesMap[targetId]) {
    cancelPredecessorDraw();
    return;
  }
  
  const sourceId = predecessorDrawMode;
  cancelPredecessorDraw();
  
  // targetId becomes predecessor of sourceId
  const sourceAct = activitiesMap[sourceId];
  if (sourceAct.predecessors.includes(targetId)) {
    alert(`${targetId} is already a predecessor of ${sourceId}.`);
    return;
  }
  if (sourceId === targetId) {
    alert("Cannot add self as predecessor.");
    return;
  }
  
  sourceAct.predecessors.push(targetId);
  const sourceBase = baseActivities.find(a => a.id === sourceId);
  if (sourceBase && !sourceBase.predecessors.includes(targetId)) {
    sourceBase.predecessors.push(targetId);
  }
  
  rebuildSuccessors();
  recomputeCPM();
  resetSimulation();
}

function deleteNode(nodeId) {
  if (!activitiesMap[nodeId]) {
    alert("Node does not exist.");
    return;
  }

  if (!confirm(`Delete node ${nodeId}? All connected edges will be removed.`)) {
    return;
  }

  // Remove from baseActivities
  const baseIndex = baseActivities.findIndex(a => a.id === nodeId);
  if (baseIndex >= 0) {
    baseActivities.splice(baseIndex, 1);
  }

  // Remove from activitiesMap
  delete activitiesMap[nodeId];

  // Remove this node from all other nodes' predecessors/successors
  Object.values(activitiesMap).forEach(act => {
    act.predecessors = act.predecessors.filter(id => id !== nodeId);
    act.successors = act.successors.filter(id => id !== nodeId);
    
    // Also update baseActivities
    const baseAct = baseActivities.find(a => a.id === act.id);
    if (baseAct) {
      baseAct.predecessors = baseAct.predecessors.filter(id => id !== nodeId);
    }
  });

  rebuildSuccessors();
  recomputeCPM();
  resetSimulation();

  console.log(`Deleted node ${nodeId}`);
}

function addSuccessorEdge(sourceId, targetId) {
  if (!activitiesMap[sourceId] || !activitiesMap[targetId]) {
    alert("Both source and target must exist.");
    return;
  }
  if (sourceId === targetId) {
    alert("Cannot add self as successor.");
    return;
  }

  const targetAct = activitiesMap[targetId];
  if (targetAct.predecessors.includes(sourceId)) {
    alert(`${targetId} already has ${sourceId} as predecessor.`);
    return;
  }

  // Update predecessors of target
  targetAct.predecessors.push(sourceId);
  const targetBase = baseActivities.find(a => a.id === targetId);
  if (targetBase && !targetBase.predecessors.includes(sourceId)) {
    targetBase.predecessors.push(sourceId);
  }

  // Update successors of source
  const sourceAct = activitiesMap[sourceId];
  if (!sourceAct.successors.includes(targetId)) {
    sourceAct.successors.push(targetId);
  }

  rebuildSuccessors();
  recomputeCPM();
  resetSimulation();
}

function addNewSuccessorNode(sourceId) {
  if (!activitiesMap[sourceId]) {
    alert("Source node does not exist.");
    return;
  }

  const suggested = generateUniqueId();
  const newId = prompt("Enter ID for new successor node", suggested);
  if (newId === null) return;
  const cleanId = newId.trim();
  if (!cleanId) return;

  if (activitiesMap[cleanId]) {
    alert(`Node ${cleanId} already exists.`);
    return;
  }

  const durationInput = prompt("Enter duration for new node", "1");
  const duration = durationInput ? parseInt(durationInput, 10) : 1;
  if (isNaN(duration) || duration < 1) {
    alert("Please enter a valid positive duration.");
    return;
  }

  // Place near source with slight offset; fall back to non-overlapping finder
  const source = activitiesMap[sourceId];
  const offset = 0.12;
  const candidate = {
    x: Math.min(0.9, Math.max(0.1, source.xRel + offset)),
    y: Math.min(0.9, Math.max(0.1, source.yRel + offset)),
  };

  // Check overlap; if overlapping, use spiral search
  let position = candidate;
  let overlaps = false;
  for (const act of Object.values(activitiesMap)) {
    const dx = act.xRel - candidate.x;
    const dy = act.yRel - candidate.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 0.12) {
      overlaps = true;
      break;
    }
  }
  if (overlaps) {
    position = findNonOverlappingPosition(duration);
  }

  // Create new activity with predecessor as sourceId
  const newActivity = {
    id: cleanId,
    duration,
    predecessors: [sourceId],
    x: position.x,
    y: position.y,
  };
  baseActivities.push(newActivity);

  activitiesMap[cleanId] = {
    id: cleanId,
    duration,
    predecessors: [sourceId],
    successors: [],
    xRel: position.x,
    yRel: position.y,
    state: "not_started",
    startTime: null,
    finishTime: null,
    progress: 0,
  };

  // Link source to new successor
  const sourceAct = activitiesMap[sourceId];
  if (!sourceAct.successors.includes(cleanId)) {
    sourceAct.successors.push(cleanId);
  }

  rebuildSuccessors();
  recomputeCPM();
  resetSimulation();

  console.log(`Added node ${cleanId} as successor of ${sourceId}`);
}

// ----------------------
// CPM computation
// ----------------------

// Forward pass: compute ES and EF assuming baseActivities are in topo order
// Replace the existing computeForwardPass function in script.js

function computeForwardPass() {
  const ES_local = {};
  const EF_local = {};
  const visited = {}; // prevent infinite loops

  function getValues(id) {
    // If we already computed this node, return cached values
    if (visited[id] === 'visited') return { es: ES_local[id], ef: EF_local[id] };
    if (visited[id] === 'visiting') {
      console.warn("Cycle detected involving " + id); // Simple cycle guard
      return { es: 0, ef: 0 }; 
    }

    visited[id] = 'visiting';
    const act = activitiesMap[id];
    
    // Calculate predecessors recursively
    let maxPredEF = 0;
    if (act.predecessors.length > 0) {
      const predEFs = act.predecessors.map(pid => getValues(pid).ef);
      maxPredEF = Math.max(...predEFs);
    }
    
    ES_local[id] = maxPredEF;
    EF_local[id] = maxPredEF + act.duration;
    
    visited[id] = 'visited';
    return { es: ES_local[id], ef: EF_local[id] };
  }

  // Compute for all activities
  baseActivities.forEach(a => getValues(a.id));

  return { ES: ES_local, EF: EF_local };
}

// Backward pass: compute LS, LF, slack and project duration
function computeBackwardPass(EF_local) {
  const LS_local = {};
  const LF_local = {};

  // Guard against empty EF_local
  const efValues = Object.values(EF_local);
  const projectDurationLocal = efValues.length > 0 ? Math.max(...efValues) : 0;

  // Process in reverse topological order
  [...baseActivities].reverse().forEach(a => {
    const act = activitiesMap[a.id];
    if (act.successors.length === 0) {
      LF_local[act.id] = projectDurationLocal;
    } else {
      LF_local[act.id] = Math.min(
        ...act.successors.map(sid => LS_local[sid])
      );
    }
    LS_local[act.id] = LF_local[act.id] - act.duration;
  });

  const slackLocal = {};
  Object.keys(EF_local).forEach(id => {
    const es = EF_local[id] - activitiesMap[id].duration;
    slackLocal[id] = LS_local[id] - es;
  });

  return {
    LS: LS_local,
    LF: LF_local,
    slack: slackLocal,
    projectDuration: projectDurationLocal,
  };
}

// ----------------------
// SVG utilities
// ----------------------

function getSvgSize() {
  const width = svg.clientWidth || svg.getBoundingClientRect().width || 800;
  const height = svg.clientHeight || svg.getBoundingClientRect().height || 500;
  return { width, height };
}

function clearSvg() {
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
}

function createArrowMarker() {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("markerWidth", "20");
  marker.setAttribute("markerHeight", "20");
  marker.setAttribute("viewBox", "0 0 20 20");
  marker.setAttribute("refX", "18");
  marker.setAttribute("refY", "10");
  marker.setAttribute("markerUnits", "strokeWidth");
  marker.setAttribute("orient", "auto");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M2,2 L18,10 L2,18 Z");
  path.setAttribute("fill", "#222");

  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);
}

// Get pixel coordinates from relative x/y
function getNodePixelPosition(act) {
  const { width, height } = getSvgSize();
  const paddingX = width * 0.05;
  const paddingY = height * 0.1;
  const usableWidth = width - 2 * paddingX;
  const usableHeight = height - 2 * paddingY;

  const cx = paddingX + act.xRel * usableWidth;
  const cy = paddingY + act.yRel * usableHeight;
  return { cx, cy };
}

// Draw a single node with a circle outline and vertical fluid fill
function drawNode(act, isCritical) {
  const { cx, cy } = getNodePixelPosition(act);
  const { width, height } = getSvgSize();

  // Make radius scale with screen size and duration
  const sizeBase = Math.min(width, height) / 16; // increased from 20 for larger nodes
  // Treat duration 0 as duration 1 for sizing purposes (start/end nodes)
  const effectiveDuration = act.duration === 0 ? 1 : act.duration;
  const radius = sizeBase * 0.8 + effectiveDuration * (sizeBase / 3); // increased coefficients

  // Create a clip path for the fluid to maintain circular shape
  const clipId = `clip-${act.id}`;
  const defs = svg.querySelector("defs") || document.createElementNS("http://www.w3.org/2000/svg", "defs");
  if (!svg.querySelector("defs")) {
    svg.appendChild(defs);
  }
  // Remove old clip path if exists
  const oldClip = defs.querySelector(`#${clipId}`);
  if (oldClip) {
    oldClip.remove();
  }
  const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
  clipPath.setAttribute("id", clipId);
  const clipCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  clipCircle.setAttribute("cx", cx);
  clipCircle.setAttribute("cy", cy);
  clipCircle.setAttribute("r", radius);
  clipPath.appendChild(clipCircle);
  defs.appendChild(clipPath);

  // Background circle (empty state)
  const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bgCircle.setAttribute("cx", cx);
  bgCircle.setAttribute("cy", cy);
  bgCircle.setAttribute("r", radius);
  
  let fillColor = "#fff";
  // Light purple for start/end nodes (duration 0)
  if (act.duration === 0) {
    fillColor = "#e1d5e7";
  } else {
    if (act.state === "in_progress") fillColor = "#e3f2fd";
    if (act.state === "completed") fillColor = "#c8e6c9";
    if (act.state === "unfilling") fillColor = "#ffe0b2"; // Light orange for unfilling
    if (act.state === "unfilled") fillColor = "#fff"; // Back to white when unfilled
  }
  
  bgCircle.setAttribute("fill", fillColor);
  svg.appendChild(bgCircle);

  // Fluid fill (circular, clipped from bottom)
  if (act.progress > 0) {
    const fluidHeight = 2 * radius * act.progress;
    const fluidY = cy + radius - fluidHeight;
    
    const fluidRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    fluidRect.setAttribute("x", cx - radius);
    fluidRect.setAttribute("y", fluidY);
    fluidRect.setAttribute("width", 2 * radius);
    fluidRect.setAttribute("height", fluidHeight);
    fluidRect.setAttribute("fill", "#4a90e2");
    fluidRect.setAttribute("opacity", "0.8");
    fluidRect.setAttribute("clip-path", `url(#${clipId})`);
    svg.appendChild(fluidRect);
  }

  // Outline circle
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", cx);
  circle.setAttribute("cy", cy);
  circle.setAttribute("r", radius);
  
  // Determine stroke color based on state and slack
  let strokeColor = "#333";
  let strokeWidth = "2";
  
  // Helper to check critical with epsilon for floating point safety
  const isTrulyCritical = slack[act.id] !== undefined && Math.abs(slack[act.id]) < 0.001;
  const hasSlack = slack[act.id] !== undefined && slack[act.id] > 0.001;
  const isStartZeroDuration = act.id === "START" && act.duration === 0;

  // Waiting state: node finished, has slack, and at least one successor
  // cannot start yet because other predecessors are not completed.
  const hasSuccessors = Array.isArray(act.successors) && act.successors.length > 0;
  const isWaitingDueToSlack = (
    hasSlack &&
    act.state === "completed" &&
    hasSuccessors &&
    act.successors.some(sid => {
      const succ = activitiesMap[sid];
      return succ && succ.state === "not_started" && !canStart(succ);
    })
  );

  // 1. Show Critical Path (Red) if button is toggled ON
  if (showCriticalActivities) {
    if (isTrulyCritical || isStartZeroDuration) {
      strokeColor = "#ff0000"; // Red for critical
      strokeWidth = "5";
    } else if (hasSlack) {
      strokeColor = "#ffc107"; // Yellow for non-critical
      strokeWidth = "4";
    }
  } 
  // 2. Otherwise, show Yellow only when a completed slack node is waiting
  // for a successor that cannot start yet.
  else if (isWaitingDueToSlack) {
    strokeColor = "#ffc107";
    strokeWidth = "4";
  }


  
  
  circle.setAttribute("stroke", strokeColor);
  circle.setAttribute("stroke-width", strokeWidth);
  circle.setAttribute("fill", "none");
  svg.appendChild(circle);

  // Label (id)
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", cx);
  text.setAttribute("y", cy);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute(
    "font-size",
    Math.max(12, radius * 0.5).toString()
  );
  text.textContent = act.id;
  text.style.pointerEvents = "none";
  svg.appendChild(text);

  // Duration label under ID
  const durationText = document.createElementNS("http://www.w3.org/2000/svg", "text");
  durationText.setAttribute("x", cx);
  durationText.setAttribute("y", cy + Math.max(12, radius * 0.35));
  durationText.setAttribute("text-anchor", "middle");
  durationText.setAttribute("dominant-baseline", "middle");
  durationText.setAttribute("font-size", Math.max(10, radius * 0.35).toString());
  durationText.textContent = `${act.duration}`;
  durationText.style.pointerEvents = "none";
  svg.appendChild(durationText);
  
  // Hit area covering entire node (so clicks aren't limited to the stroke)
  const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hit.setAttribute("cx", cx);
  hit.setAttribute("cy", cy);
  hit.setAttribute("r", radius);
  hit.setAttribute("fill", "transparent");
  hit.style.cursor = "move";

  // Double-click to edit duration
  hit.addEventListener("dblclick", () => {
    if (running) return; // Can't edit during simulation
    editNodeDuration(act);
  });

  // Mouse down to start dragging
  hit.addEventListener("mousedown", (e) => {
    // Complete predecessor draw if in draw mode
    if (predecessorDrawMode && predecessorDrawMode !== act.id) {
      completePredecessorDraw(act.id);
      return;
    }

    if (running) return; // Can't drag during simulation
    e.stopPropagation();
    draggedNode = act;

    const { cx, cy } = getNodePixelPosition(act);
    const svgRect = svg.getBoundingClientRect();
    const mouseX = e.clientX - svgRect.left;
    const mouseY = e.clientY - svgRect.top;

    dragOffset.x = mouseX - cx;
    dragOffset.y = mouseY - cy;
  });

  // Right-click to open context menu
  hit.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (predecessorDrawMode) {
      cancelPredecessorDraw();
      return;
    }
    if (running) return;
    showContextMenu(act, e.clientX, e.clientY);
  });

  svg.appendChild(hit);
}

// Draw edges and all nodes
function drawStaticNetwork() {
  clearSvg();
  createArrowMarker();

  // Draw edges first (so they appear behind nodes)
  Object.values(activitiesMap).forEach(act => {
    const { cx: x1, cy: y1 } = getNodePixelPosition(act);
    act.successors.forEach(sid => {
      const succ = activitiesMap[sid];
      const { cx: x2, cy: y2 } = getNodePixelPosition(succ);

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke", "#555");
      line.setAttribute("stroke-width", "2");
      svg.appendChild(line);

      // Arrowhead placed at mid-segment to avoid overlapping nodes
      const dx = x2 - x1;
      const dy = y2 - y1;
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const t = 0.55; // position along the line (0=start,1=end)
      const ax = x1 + dx * t;
      const ay = y1 + dy * t;

      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
      arrow.setAttribute("d", "M0,-5 L10,0 L0,5 Z");
      arrow.setAttribute("fill", "#555");
      arrow.setAttribute("transform", `translate(${ax},${ay}) rotate(${angleDeg})`);
      svg.appendChild(arrow);
    });
  });

  // Draw nodes
  Object.values(activitiesMap).forEach(act => {
    const isCritical = slack[act.id] !== undefined && slack[act.id] === 0;
    drawNode(act, isCritical);
  });

  // Draw predecessor draw mode preview line
  if (predecessorDrawMode && activitiesMap[predecessorDrawMode]) {
    const sourceAct = activitiesMap[predecessorDrawMode];
    const { cx, cy } = getNodePixelPosition(sourceAct);
    
    const previewLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    previewLine.setAttribute("x1", cx);
    previewLine.setAttribute("y1", cy);
    previewLine.setAttribute("x2", cursorX);
    previewLine.setAttribute("y2", cursorY);
    previewLine.setAttribute("stroke", "#ff9800");
    previewLine.setAttribute("stroke-width", "3");
    previewLine.setAttribute("stroke-dasharray", "5,5");
    previewLine.style.pointerEvents = "none";
    svg.appendChild(previewLine);
  }
}

// ----------------------
// Simulation logic
// ----------------------

// An activity can start when all predecessors are completed
function canStart(act) {
  return act.predecessors.every(
    pid => activitiesMap[pid].state === "completed"
  );
}

function updateTimeDisplay() {
  if (!timeDisplay) return;
  const duration = (projectDuration && !isNaN(projectDuration) && projectDuration > 0) ? projectDuration : 0;
  let displayTime = currentTime;
  if (runningBackward) {
    const elapsedBackward = backwardStartTime != null ? (currentTime - backwardStartTime) : 0;
    displayTime = Math.max(0, duration - elapsedBackward);
  }
  timeDisplay.textContent = `Project Time: ${displayTime.toFixed(1)} / ${duration.toFixed(1)}`;
}

// Draw timeline visualization
function drawTimeline() {
  if (!timelineSvg) return;
  const validDuration = (projectDuration && projectDuration > 0 && !isNaN(projectDuration)) ? projectDuration : 10;

  // Get container width - use parent's width if SVG width is not set
  const container = timelineSvg.parentElement;
  const containerWidth = container ? container.offsetWidth : 800;
  const width = Math.max(400, containerWidth - 40); // Leave some padding
  const height = 100;
  const padding = 60;
  const timelineY = 50;
  const usableWidth = width - 2 * padding;

  // Clear timeline
  while (timelineSvg.firstChild) {
    timelineSvg.removeChild(timelineSvg.firstChild);
  }

  // Set SVG dimensions - use viewBox for proper scaling
  timelineSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  timelineSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Draw background
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", width);
  bg.setAttribute("height", height);
  bg.setAttribute("fill", "#fff");
  timelineSvg.appendChild(bg);

  // Draw timeline base line
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", padding);
  line.setAttribute("y1", timelineY);
  line.setAttribute("x2", padding + usableWidth);
  line.setAttribute("y2", timelineY);
  line.setAttribute("stroke", "#333");
  line.setAttribute("stroke-width", "2");
  timelineSvg.appendChild(line);

  // Draw time tick marks and labels
  const step = Math.max(1, Math.floor(validDuration / 8));
  for (let t = 0; t <= validDuration; t += step) {
    const x = padding + (t / validDuration) * usableWidth;
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", x);
    tick.setAttribute("y1", timelineY - 5);
    tick.setAttribute("x2", x);
    tick.setAttribute("y2", timelineY + 5);
    tick.setAttribute("stroke", "#666");
    tick.setAttribute("stroke-width", "1");
    timelineSvg.appendChild(tick);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", x);
    label.setAttribute("y", timelineY + 18);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "11");
    label.setAttribute("fill", "#666");
    label.textContent = Math.round(t);
    timelineSvg.appendChild(label);
  }

  // Draw start events (green, above line)
  activityStartEvents.forEach((event) => {
    if (typeof event.time !== 'number' || event.time < 0 || event.time > validDuration) return;
    const x = padding + (event.time / validDuration) * usableWidth;
    
    // Vertical dash
    const dash = document.createElementNS("http://www.w3.org/2000/svg", "line");
    dash.setAttribute("x1", x);
    dash.setAttribute("y1", timelineY - 10);
    dash.setAttribute("x2", x);
    dash.setAttribute("y2", timelineY);
    dash.setAttribute("stroke", "#4caf50");
    dash.setAttribute("stroke-width", "2");
    timelineSvg.appendChild(dash);
  });

  // Draw end events (blue, below line)
  activityEndEvents.forEach((event) => {
    if (typeof event.time !== 'number' || event.time < 0 || event.time > validDuration) return;
    const x = padding + (event.time / validDuration) * usableWidth;
    
    // Vertical dash
    const dash = document.createElementNS("http://www.w3.org/2000/svg", "line");
    dash.setAttribute("x1", x);
    dash.setAttribute("y1", timelineY);
    dash.setAttribute("x2", x);
    dash.setAttribute("y2", timelineY + 10);
    dash.setAttribute("stroke", "#1976d2");
    dash.setAttribute("stroke-width", "2");
    timelineSvg.appendChild(dash);
  });
}


// Main simulation loop
// Activities can start at t=0; increment time after drawing each frame
function updateSimulation() {
  if (!running || paused) return;

  // Update states at the current time (do not increment yet)
  Object.values(activitiesMap).forEach(act => {
    if (act.state === "not_started" && canStart(act)) {
      act.state = "in_progress";
      act.startTime = currentTime;
      // Track start event
      if (!activityStartEvents.some(e => e.id === act.id)) {
        const startTime = currentTime;
        activityStartEvents.push({ id: act.id, time: startTime });
      }
    }

    if (act.state === "in_progress") {
      if (act.duration === 0) {
        act.progress = 1;
        act.state = "completed";
        act.finishTime = currentTime;
        // Track end event
        if (!activityEndEvents.some(e => e.id === act.id)) {
          const endTime = currentTime;
          activityEndEvents.push({ id: act.id, time: endTime });
        }
      } else {
        const elapsed = currentTime - act.startTime;
        act.progress = Math.min(1, elapsed / act.duration);
        if (act.progress >= 1) {
          act.state = "completed";
          act.finishTime = currentTime;
          // Track end event
          if (!activityEndEvents.some(e => e.id === act.id)) {
            const endTime = currentTime;
            activityEndEvents.push({ id: act.id, time: endTime });
          }
        }
      }
    }
  });

  // Draw visuals for the current time
  drawStaticNetwork();
  updateTimeDisplay();

  const allDone = Object.values(activitiesMap).every(
    act => act.state === "completed"
  );

  if (!allDone) {
    // Advance time for the next frame
    currentTime += timeStep * speedMultiplier;
    updateTimeDisplay();
    requestAnimationFrame(updateSimulation);
  } else {
    // Snap time to project duration on completion for a clean end state
    currentTime = projectDuration;
    updateTimeDisplay();
    running = false;
    showProjectEnd = true;
    // Show backward pass and critical activities buttons when forward pass finishes
    if (startBackwardButton) {
      startBackwardButton.style.display = "inline-block";
    }
    if (showCriticalButton) {
      showCriticalButton.style.display = "inline-block";
      showCriticalButton.textContent = "Show critical activities";
      showCriticalActivities = false;
    }
    // Update timeline to reflect the end marker and full progress
    drawTimeline();
    console.log("Forward pass finished at time", currentTime.toFixed(1));
  }
}

// Reset state (but keep CPM results)
function resetSimulation() {
  currentTime = 0;
  activityStartEvents = [];
  activityEndEvents = [];
  backwardStartTime = null;
  updateTimeDisplay();
  showCriticalActivities = false;
  runningBackward = false;
  showProjectEnd = false;
  paused = false;
  if (startBackwardButton) {
    startBackwardButton.style.display = "none";
  }
  if (showCriticalButton) {
    showCriticalButton.style.display = "none";
  }
  if (pauseResumeButton) {
    pauseResumeButton.style.display = "none";
    pauseResumeButton.textContent = "Pause";
  }
  Object.values(activitiesMap).forEach(act => {
    act.state = "not_started";
    act.startTime = null;
    act.finishTime = null;
    act.progress = 0;
  });
  drawStaticNetwork();
}

// Start from scratch
function startSimulation() {
  resetSimulation();
  running = true;
  paused = false;
  if (pauseResumeButton) {
    pauseResumeButton.style.display = "inline-block";
    pauseResumeButton.textContent = "Pause";
  }
  requestAnimationFrame(updateSimulation);
}

// Start backward pass
function startBackwardPass() {
  // Make sure all nodes are completed first
  const allCompleted = Object.values(activitiesMap).every(
    act => act.state === "completed"
  );
  
  if (!allCompleted) {
    alert("Run the forward pass first!");
    return;
  }
  
  // Set all nodes to "unfilling" state
  Object.values(activitiesMap).forEach(act => {
    act.state = "unfilling";
    act.unfillStartTime = null;
  });
  // Anchor backward time to current end (should be projectDuration)
  backwardStartTime = currentTime;
  
  runningBackward = true;
  if (startBackwardButton) {
    startBackwardButton.style.display = "none";
  }
  if (pauseResumeButton) {
    pauseResumeButton.style.display = "inline-block";
    pauseResumeButton.textContent = "Pause";
  }
  paused = false;
  requestAnimationFrame(updateBackwardPass);
}

// Check if a node can start unfilling (all successors must be unfilled)
function canStartUnfilling(act) {
  if (!act.successors || act.successors.length === 0) {
    return true; // No successors, can unfill
  }
  
  // All successors must be fully unfilled
  return act.successors.every(succId => {
    const succ = activitiesMap[succId];
    return succ && succ.state === "unfilled";
  });
}

// Update backward pass animation
function updateBackwardPass() {
  if (!runningBackward || paused) return;

  currentTime += timeStep * speedMultiplier;
  updateTimeDisplay();

  Object.values(activitiesMap).forEach(act => {
    if (act.state === "unfilling" && canStartUnfilling(act)) {
      if (act.unfillStartTime === null) {
        act.unfillStartTime = currentTime;
      }
      
      // Nodes with 0 duration unfill instantly
      if (act.duration === 0) {
        act.progress = 0;
        act.state = "unfilled";
      } else {
        const elapsed = currentTime - act.unfillStartTime;
        act.progress = Math.max(0, 1 - elapsed / act.duration);
        if (act.progress <= 0) {
          act.state = "unfilled";
          act.progress = 0;
        }
      }
    }
  });

  drawStaticNetwork();

  const allUnfilled = Object.values(activitiesMap).every(
    act => act.state === "unfilled"
  );
  
  if (!allUnfilled) {
    requestAnimationFrame(updateBackwardPass);
  } else {
    runningBackward = false;
    console.log("Backward pass finished at time", currentTime.toFixed(1));
  }
}

// ----------------------
// Event wiring
// ----------------------

// Resize SVG to fill width and a portion of height
function resizeSvg() {
  const width = window.innerWidth || 1000;
  const height = window.innerHeight || 600;
  svg.setAttribute("width", width);
  svg.setAttribute("height", height * 0.4);
  drawStaticNetwork();
}

window.addEventListener("resize", resizeSvg);

// Canvas resize from bottom edge
svg.addEventListener("mousedown", (e) => {
  const rect = svg.getBoundingClientRect();
  const distFromBottom = rect.bottom - e.clientY;
  const bottomZone = 15; // pixels from bottom edge to detect resize
  
  if (distFromBottom <= bottomZone && distFromBottom >= 0 && !draggedNode) {
    e.preventDefault();
    resizingCanvas = true;
    resizeStartY = e.clientY;
    resizeStartHeight = svg.clientHeight;
    svg.style.cursor = "ns-resize";
  }
});

document.addEventListener("mousemove", (e) => {
  if (!resizingCanvas) return;
  
  const deltaY = e.clientY - resizeStartY;
  
  const newHeight = Math.max(200, resizeStartHeight + deltaY); // min height 200px
  
  svg.style.height = newHeight + "px";
  svg.setAttribute("height", newHeight);
  
  drawStaticNetwork();
});

document.addEventListener("mouseup", () => {
  resizingCanvas = false;
  svg.style.cursor = "auto";
});

// Show cursor hint when hovering near bottom edge
svg.addEventListener("mouseover", (e) => {
  const rect = svg.getBoundingClientRect();
  const distFromBottom = rect.bottom - e.clientY;
  const bottomZone = 15;
  
  if (distFromBottom <= bottomZone && distFromBottom >= 0) {
    svg.style.cursor = "ns-resize";
  } else {
    svg.style.cursor = "auto";
  }
});

svg.addEventListener("mouseleave", () => {
  if (!resizingCanvas) {
    svg.style.cursor = "auto";
  }
});
// Dragging: track mouse to move nodes
svg.addEventListener("mousemove", (e) => {
  const svgRect = svg.getBoundingClientRect();
  cursorX = e.clientX - svgRect.left;
  cursorY = e.clientY - svgRect.top;

  // Update preview during predecessor draw mode
  if (predecessorDrawMode) {
    drawStaticNetwork();
    return;
  }

  if (!draggedNode || running || runningBackward) return;

  // Convert pixel coordinates to relative coordinates
  const { width, height } = getSvgSize();
  const paddingX = width * 0.05;
  const paddingY = height * 0.1;
  const usableWidth = width - 2 * paddingX;
  const usableHeight = height - 2 * paddingY;

  const targetX = cursorX - dragOffset.x;
  const targetY = cursorY - dragOffset.y;

  const xRel = (targetX - paddingX) / usableWidth;
  const yRel = (targetY - paddingY) / usableHeight;

  // Clamp to valid range
  draggedNode.xRel = Math.max(0, Math.min(1, xRel));
  draggedNode.yRel = Math.max(0, Math.min(1, yRel));

  // Update in baseActivities too
  const baseAct = baseActivities.find(a => a.id === draggedNode.id);
  if (baseAct) {
    baseAct.x = draggedNode.xRel;
    baseAct.y = draggedNode.yRel;
  }

  drawStaticNetwork();
});

// Release drag on mouse up or when leaving canvas
svg.addEventListener("mouseup", () => {
  draggedNode = null;
});

svg.addEventListener("mouseleave", () => {
  draggedNode = null;
  if (predecessorDrawMode) {
    cancelPredecessorDraw();
  }
});

// Cancel predecessor draw on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && predecessorDrawMode) {
    cancelPredecessorDraw();
  }
});

// Buttons
if (startButton) {
  startButton.addEventListener("click", () => {
    if (!running) {
      startSimulation();
    }
  });
}

if (resetButton) {
  resetButton.addEventListener("click", () => {
    running = false;
    runningBackward = false;
    resetSimulation();
  });
}

if (startBackwardButton) {
  startBackwardButton.addEventListener("click", () => {
    if (!runningBackward) {
      startBackwardPass();
    }
  });
}

if (addNodeButton) {
  addNodeButton.addEventListener("click", addNode);
}

if (addBatchButton) {
  addBatchButton.addEventListener("click", addBatchNodes);
}

if (addStartEndButton) {
  addStartEndButton.addEventListener("click", addStartEndNodes);
}

// Context menu actions
if (addSuccessorButton) {
  addSuccessorButton.addEventListener("click", () => {
    if (running || runningBackward) {
      alert("Cannot edit during simulation.");
      hideContextMenu();
      return;
    }

    const sourceId = contextSourceId;
    hideContextMenu();
    if (!sourceId) return;

    const targetId = prompt("Enter successor node ID (existing node)");
    if (!targetId) return;

    const cleanTarget = targetId.trim();
    if (!cleanTarget) return;

    addSuccessorEdge(sourceId, cleanTarget);
  });
}

if (addNewSuccessorButton) {
  addNewSuccessorButton.addEventListener("click", () => {
    if (running || runningBackward) {
      alert("Cannot edit during simulation.");
      hideContextMenu();
      return;
    }

    const sourceId = contextSourceId;
    hideContextMenu();
    if (!sourceId) return;

    addNewSuccessorNode(sourceId);
  });
}

if (editDurationButton) {
  editDurationButton.addEventListener("click", () => {
    if (running || runningBackward) {
      alert("Cannot edit during simulation.");
      hideContextMenu();
      return;
    }
    const sourceId = contextSourceId;
    hideContextMenu();
    if (!sourceId || !activitiesMap[sourceId]) return;
    editNodeDuration(activitiesMap[sourceId]);
  });
}

if (addPredecessorButton) {
  addPredecessorButton.addEventListener("click", () => {
    if (running || runningBackward) {
      alert("Cannot edit during simulation.");
      hideContextMenu();
      return;
    }
    const sourceId = contextSourceId;
    hideContextMenu();
    if (!sourceId) return;
    startPredecessorDraw(sourceId);
  });
}

if (deleteNodeButton) {
  deleteNodeButton.addEventListener("click", () => {
    if (running || runningBackward) {
      alert("Cannot edit during simulation.");
      hideContextMenu();
      return;
    }
    const nodeId = contextSourceId;
    hideContextMenu();
    if (!nodeId) return;
    deleteNode(nodeId);
  });
}

// Speed control
if (speedSlider) {
  speedSlider.addEventListener("input", (e) => {
    speedMultiplier = parseFloat(e.target.value);
    if (speedLabel) {
      speedLabel.textContent = speedMultiplier.toFixed(1) + "x";
    }
  });
}

// Show critical activities button
if (showCriticalButton) {
  showCriticalButton.addEventListener("click", () => {
    showCriticalActivities = !showCriticalActivities;
    showCriticalButton.textContent = showCriticalActivities 
      ? "Hide critical activities" 
      : "Show critical activities";
    
    // Debug: log slack values
    console.log("Critical activities mode:", showCriticalActivities);
    console.log("Slack values:", slack);
    const criticalNodes = Object.keys(slack).filter(id => slack[id] === 0);
    console.log("Critical nodes:", criticalNodes.join(", ") || "none");
    
    drawStaticNetwork();
  });
}

// Hide context menu on outside click
document.addEventListener("click", (e) => {
  if (!contextMenu) return;
  if (contextMenu.style.display === "none") return;
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// Pause/Resume toggle
if (pauseResumeButton) {
  pauseResumeButton.addEventListener("click", () => {
    if (!(running || runningBackward)) return;
    paused = !paused;
    if (paused) {
      pauseResumeButton.textContent = "Resume";
      // Loops will naturally stop on the next frame due to paused check
    } else {
      pauseResumeButton.textContent = "Pause";
      // Resume the appropriate loop
      if (running) requestAnimationFrame(updateSimulation);
      else if (runningBackward) requestAnimationFrame(updateBackwardPass);
    }
  });
}

// Add node functionality
function addNode() {
  if (running || runningBackward) {
    alert("Cannot add nodes during simulation");
    return;
  }
  
  const id = inputNodeId.value.trim();
  if (!id) {
    alert("Please enter a node ID");
    return;
  }
  
  if (activitiesMap[id]) {
    alert(`Node ${id} already exists`);
    return;
  }
  
  const duration = parseInt(inputDuration.value) || 3;
  const predsInput = inputPredecessors.value.trim();
  const predecessors = predsInput ? predsInput.split(",").map(s => s.trim()).filter(s => s) : [];
  
  // Validate predecessors exist
  for (const pred of predecessors) {
    if (!activitiesMap[pred]) {
      alert(`Predecessor ${pred} does not exist`);
      return;
    }
  }
  
  // Find non-overlapping position
  const position = findNonOverlappingPosition(duration);
  
  // Add to baseActivities
  const newActivity = {
    id,
    duration,
    predecessors,
    x: position.x,
    y: position.y,
  };
  baseActivities.push(newActivity);
  
  // Add to activitiesMap
  activitiesMap[id] = {
    id,
    duration,
    predecessors: [...predecessors],
    successors: [],
    xRel: newActivity.x,
    yRel: newActivity.y,
    state: "not_started",
    startTime: null,
    finishTime: null,
    progress: 0,
  };
  
  rebuildSuccessors();
  recomputeCPM();
  resetSimulation();
  
  // Clear inputs
  inputNodeId.value = "";
  inputPredecessors.value = "";
  
  console.log(`Added node ${id}`);
}

// Batch add nodes with default duration 1
function addBatchNodes() {
  if (running || runningBackward) {
    alert("Cannot add nodes during simulation");
    return;
  }
  const count = parseInt(inputBatchCount ? inputBatchCount.value : "0", 10);
  if (isNaN(count) || count < 1) {
    alert("Enter a valid batch count (>=1)");
    return;
  }

  const created = [];
  const yPos = 0.5;  // Fixed vertical position (middle)
  const startX = 0.1;
  const endX = 0.9;
  const spacing = (endX - startX) / (count + 1);

  for (let i = 0; i < count; i++) {
    const newId = generateUniqueId();
    const duration = 1;
    const xPos = startX + spacing * (i + 1);

    const newActivity = {
      id: newId,
      duration,
      predecessors: [],
      x: xPos,
      y: yPos,
    };
    baseActivities.push(newActivity);
    activitiesMap[newId] = {
      id: newId,
      duration,
      predecessors: [],
      successors: [],
      xRel: xPos,
      yRel: yPos,
      state: "not_started",
      startTime: null,
      finishTime: null,
      progress: 0,
    };
    created.push(newId);
  }

  rebuildSuccessors();
  recomputeCPM();
  resetSimulation();

  console.log(`Batch added nodes: ${created.join(",")}`);
}

// Add start and end nodes
function addStartEndNodes() {
  if (running || runningBackward) {
    alert("Cannot add nodes during simulation");
    return;
  }

  const allNodes = Object.values(activitiesMap);
  if (allNodes.length === 0) {
    alert("No nodes to connect. Add some nodes first.");
    return;
  }

  let addedStart = false;
  let addedEnd = false;

  // Find nodes without predecessors
  const noPredecessors = allNodes.filter(node => 
    !node.predecessors || node.predecessors.length === 0
  );

  // Add START node only if 2+ nodes without predecessors
  if (noPredecessors.length >= 2 && !activitiesMap["START"]) {
    const startNode = {
      id: "START",
      duration: 0,
      predecessors: [],
      successors: [],
      xRel: 0.1,
      yRel: 0.5,
      state: "not_started",
      startTime: null,
      finishTime: null,
      progress: 0,
    };
    
    activitiesMap["START"] = startNode;
    baseActivities.push(startNode);
    
    // Make START predecessor of all nodes without predecessors
    noPredecessors.forEach(node => {
      node.predecessors.push("START");
    });
    
    addedStart = true;
    console.log(`Added START node as predecessor to: ${noPredecessors.map(n => n.id).join(", ")}`);
  }

  // Find nodes without successors
  const noSuccessors = allNodes.filter(node => 
    !node.successors || node.successors.length === 0
  );

  // Add END node only if 2+ nodes without successors
  if (noSuccessors.length >= 2 && !activitiesMap["END"]) {
    const endNode = {
      id: "END",
      duration: 0,
      predecessors: [],
      successors: [],
      xRel: 0.9,
      yRel: 0.5,
      state: "not_started",
      startTime: null,
      finishTime: null,
      progress: 0,
    };
    
    activitiesMap["END"] = endNode;
    baseActivities.push(endNode);
    
    // Make END successor of all nodes without successors
    noSuccessors.forEach(node => {
      endNode.predecessors.push(node.id);
    });
    
    addedEnd = true;
    console.log(`Added END node as successor to: ${noSuccessors.map(n => n.id).join(", ")}`);
  }

  if (addedStart || addedEnd) {
    rebuildSuccessors();
    recomputeCPM();
    resetSimulation();
    
    let message = "Added: ";
    if (addedStart && addedEnd) {
      message += "START and END nodes";
    } else if (addedStart) {
      message += "START node";
    } else {
      message += "END node";
    }
    console.log(message);
  } else {
    let reason = [];
    if (noPredecessors.length < 2) {
      reason.push(`Only ${noPredecessors.length} node(s) without predecessors (need 2+)`);
    }
    if (noSuccessors.length < 2) {
      reason.push(`Only ${noSuccessors.length} node(s) without successors (need 2+)`);
    }
    if (activitiesMap["START"]) {
      reason.push("START already exists");
    }
    if (activitiesMap["END"]) {
      reason.push("END already exists");
    }
    console.log("No nodes added. " + reason.join(". "));
  }
}

// Edit node duration
function editNodeDuration(act) {
  const newDuration = prompt(`Edit duration for node ${act.id}:`, act.duration);
  if (newDuration === null) return;
  
  const duration = parseInt(newDuration);
  if (isNaN(duration) || duration < 1) {
    alert("Please enter a valid duration (positive integer)");
    return;
  }
  
  // Update duration in both places
  act.duration = duration;
  const baseAct = baseActivities.find(a => a.id === act.id);
  if (baseAct) {
    baseAct.duration = duration;
  }
  
  recomputeCPM();
  resetSimulation();
  
  console.log(`Updated node ${act.id} duration to ${duration}`);
}

// Recompute CPM after changes
function recomputeCPM() {
  const forward = computeForwardPass();
  ES = forward.ES;
  EF = forward.EF;

  const backward = computeBackwardPass(EF);
  LS = backward.LS;
  LF = backward.LF;
  slack = backward.slack;
  projectDuration = backward.projectDuration;

  // Ensure projectDuration is a valid number
  if (isNaN(projectDuration) || projectDuration < 0) {
    projectDuration = 0;
  }

  console.log("CPM recomputed:", { projectDuration, ES, EF });
}

// ----------------------
// Initial setup
// ----------------------

function init() {
  initActivities();
  const forward = computeForwardPass();
  ES = forward.ES;
  EF = forward.EF;

  const backward = computeBackwardPass(EF);
  LS = backward.LS;
  LF = backward.LF;
  slack = backward.slack;
  projectDuration = backward.projectDuration;

  // Ensure projectDuration is a valid number
  if (isNaN(projectDuration) || projectDuration < 0) {
    projectDuration = 0;
  }

  console.log("CPM results:", { projectDuration, ES, EF });

  // Initialize speed UI (slider and label)
  if (speedSlider) {
    speedSlider.min = "0.1";
    speedSlider.max = "3.0";
    speedSlider.step = "0.1";
    speedSlider.value = speedMultiplier.toString();
  }
  if (speedLabel) {
    speedLabel.textContent = speedMultiplier.toFixed(1) + "x";
  }

  resizeSvg();
  resetSimulation();
}

init();