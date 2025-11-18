// Simple storage for walkthrough data. Everything is stored in a JSON
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const FILE_NAME = '.codetime_walkthroughs.json';

// Determine storage file location
function getStoragePath() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return null;

    const rootFolder = workspaceFolders[0].uri.fsPath;
    return path.join(rootFolder, FILE_NAME);
}

// Load all walkthroughs from disk. return empty list if none exist
function loadAllWalkthroughs() {
    const storagePath = getStoragePath();
    if (!storagePath || !fs.existsSync(storagePath)) return [];

    try {
        const rawJson = fs.readFileSync(storagePath, 'utf8');
        return JSON.parse(rawJson);
    } catch (err) {
        console.error('Failed to load walkthroughs:', err);
        return [];
    }
}

// Save full walkthrough list back to disk
function saveAllWalkthroughs(allWalkthroughs) {
    const storagePath = getStoragePath();
    if (!storagePath) return;

    const jsonText = JSON.stringify(allWalkthroughs, null, 2);
    fs.writeFileSync(storagePath, jsonText, 'utf8');
}

// Create brand new walkthrough entry
function createWalkthrough(name) {
    const allWalkthroughs = loadAllWalkthroughs();

    const walkthrough = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        createdAt: new Date().toISOString(),
        steps: []
    };

    allWalkthroughs.push(walkthrough);
    saveAllWalkthroughs(allWalkthroughs);
    return walkthrough;
}

// Add step to an existing walkthrough
function addStepToWalkthrough(walkthroughId, stepInfo) {
    const allWalkthroughs = loadAllWalkthroughs();
    const walkthrough = allWalkthroughs.find(w => w.id === walkthroughId);
    if (!walkthrough) return null;

    walkthrough.steps.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...stepInfo
    });

    saveAllWalkthroughs(allWalkthroughs);
    return walkthrough;
}

// Return all walkthrough objects
function getAllWalkthroughs() {
    return loadAllWalkthroughs();
}

module.exports = {
    createWalkthrough,
    addStepToWalkthrough,
    getAllWalkthroughs,
};
