// simple storage for walkthrough data, everything is stored in a JSON
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const FILE_NAME = '.codetime_walkthroughs.json';

// storage file location
function getStoragePath() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return null;

    const rootFolder = workspaceFolders[0].uri.fsPath;
    return path.join(rootFolder, FILE_NAME);
}

// load entire walkthrough list
function loadAllWalkthroughs() {
    const storagePath = getStoragePath();
    if (!storagePath || !fs.existsSync(storagePath)) return [];

    try {
        const rawJson = fs.readFileSync(storagePath, 'utf8').trim();
        if (!rawJson) return [];
        const parsed = JSON.parse(rawJson);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error('Failed to load walkthroughs:', err);
        return [];
    }
}

// save full walkthrough list back to the file
function saveAllWalkthroughs(allWalkthroughs) {
    const storagePath = getStoragePath();
    if (!storagePath) return;

    const jsonText = JSON.stringify(allWalkthroughs, null, 2);
    try {
        fs.writeFileSync(storagePath, jsonText, 'utf8');
    } catch (err) {
        console.error('Failed to save walkthroughs:', err);
    }
}

// create a new walkthrough entry
function createWalkthrough(name, description) {
    const all = loadAllWalkthroughs();

    const walkthrough = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        description: description || '',
        createdAt: new Date().toISOString(),
        steps: [],
        media: []
    };

    all.push(walkthrough);
    saveAllWalkthroughs(all);
    return walkthrough;
}

// get a single walkthrough by its id
function getWalkthroughById(walkthroughId) {
    const all = loadAllWalkthroughs();
    return all.find(w => w.id === walkthroughId) || null;
}

// add a step to a walkthrough
function addStepToWalkthrough(walkthroughId, stepInfo) {
    const all = loadAllWalkthroughs();
    const walkthrough = all.find(w => w.id === walkthroughId);
    if (!walkthrough) return null;

    walkthrough.steps.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...stepInfo
    });

    saveAllWalkthroughs(all);
    return walkthrough;
}

// update fields inside a walkthrough (rename, description, steps, etc)
function updateWalkthrough(walkthroughId, updatedFields) {
    const all = loadAllWalkthroughs();
    const index = all.findIndex(w => w.id === walkthroughId);
    if (index === -1) return null;

    all[index] = {
        ...all[index],
        ...updatedFields
    };

    saveAllWalkthroughs(all);
    return all[index];
}

// delete a walkthrough
function deleteWalkthrough(walkthroughId) {
    const all = loadAllWalkthroughs();
    const filtered = all.filter(w => w.id !== walkthroughId);
    saveAllWalkthroughs(filtered);
}

// return all walkthroughs
function getAllWalkthroughs() {
    return loadAllWalkthroughs();
}

module.exports = {
    createWalkthrough,
    getWalkthroughById,
    addStepToWalkthrough,
    updateWalkthrough,
    deleteWalkthrough,
    getAllWalkthroughs,
};
