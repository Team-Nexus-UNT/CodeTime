# CodeTime - Team Nexus
CSCE 4901.003 – Capstone Computer Science Project
University of North Texas

# Overview

CodeTime is a Visual Studio Code extension designed to enhance how programming concepts are taught and learned. It allows instructors to record, annotate, and export guided code walkthroughs, and enables students to replay those walkthroughs in a read-only learning environment with timeline playback and AI-assisted explanations.
The core goal of CodeTime is to bridge the gap between watching code and understanding code by synchronizing source files, Git commits, audio/video narration, and annotations into a single interactive timeline.

# Key Concepts

CodeTime operates in two modes, both accessible through the VS Code extension:

# Instructor Mode

Used to create instructional walkthroughs.

Instructors can:

Record code timelines based on file changes and Git commits

Capture audio and video narration

Add inline annotations to specific lines of code

Associate recordings and annotations with exact points on the timeline

Export the completed walkthrough into a distributable file


# Student Mode

Used to consume instructional walkthroughs.

Students can:

Import walkthrough files created in Instructor Mode

Replay the code timeline step-by-step

View synchronized code, audio, video, and annotations

Navigate freely through the timeline (play, pause, rewind, fast-forward)

Ask an integrated LLM assistant questions about the code at the current timeline position

View content in read-only mode (no editing allowed)

# Installation & Development
Prerequisites:

Visual Studio Code

Node.js

Git

Run in Development Mode

Clone the repository

Open the project in VS Code

Run npm install

Press F5 to launch the Extension Development Host

# License

This project is proprietary software developed by Team Nexus.

No part of this project may be used, copied, modified, or distributed
without explicit permission from Team Nexus.