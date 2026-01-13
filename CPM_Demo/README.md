# Critical Path Method – Fluid Simulation

An interactive educational visualization tool for teaching and learning the **Critical Path Method (CPM)** in project management. This web-based application uses a unique "fluid filling" animation to demonstrate how activities progress through a project network, making it easier to understand forward pass, backward pass, slack, and critical paths.

## 🎯 Features

### Core Functionality
- **Interactive Network Diagram**: Drag-and-drop node positioning with automatic non-overlapping placement
- **Fluid Filling Animation**: Visualize activity progress as nodes "fill up" like containers during the forward pass
- **Forward Pass Simulation**: Watch early start (ES) and early finish (EF) times unfold in real-time
- **Backward Pass Animation**: See nodes "unfill" to demonstrate late start (LS) and late finish (LF) calculations
- **Critical Path Highlighting**: Toggle to show critical activities (red borders) vs. non-critical activities (yellow borders)
- **Slack Visualization**: Yellow borders automatically appear when completed activities must wait due to slack time

### Node Management
- **Manual Node Creation**: Add individual nodes with custom IDs, durations, and predecessors
- **Batch Node Creation**: Quickly add multiple nodes with default settings
- **Auto Start/End Nodes**: Automatically create START and END nodes to connect multiple entry/exit points (duration 0)
- **Interactive Editing**:
  - Double-click nodes to edit duration
  - Right-click context menu for adding successors/predecessors
  - Drag-to-reposition nodes
  - Delete nodes with automatic edge cleanup

### Advanced Features
- **Visual Slack Indicators**: Nodes turn yellow when completed but waiting for successors (slack time)
- **Adjustable Speed Control**: 0.1x to 3.0x simulation speed (default: 0.1x for educational purposes)
- **Pause/Resume**: Control simulation playback at any time
- **Timeline Tracking**: Visual timeline shows when each activity starts (green) and completes (blue)
- **Responsive Canvas**: Resize the canvas by dragging the bottom edge
- **Predecessor Drawing Mode**: Click-to-connect interface for creating dependency relationships

## 🚀 Getting Started

### Prerequisites
- A modern web browser (Chrome, Firefox, Safari, or Edge)
- No build tools or dependencies required!

### How to Use
- Enter https://zhouy185.github.io/CPM_Demo/ in your browser

