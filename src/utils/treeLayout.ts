import type { Message } from '../stores/chat';

export interface TreeNode {
    id: string;
    message: Message;
    children: TreeNode[];
    width: number;
    height: number;
    x: number;
    y: number;
    isLeaf: boolean;
}

export interface TreeLayout {
    nodes: TreeNode[];
    width: number;
    height: number;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const HORIZONTAL_GAP = 20;
const VERTICAL_GAP = 60;

export function buildTree(messages: Message[]): TreeNode[] {
    const nodeMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    // 1. Create nodes
    messages.forEach(msg => {
        if (!msg.id) return;
        nodeMap.set(msg.id, {
            id: msg.id,
            message: msg,
            children: [],
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            x: 0,
            y: 0,
            isLeaf: true
        });
    });

    // 2. Build hierarchy
    messages.forEach(msg => {
        if (!msg.id) return;
        const node = nodeMap.get(msg.id)!;

        if (msg.parentId) {
            const parent = nodeMap.get(msg.parentId);
            if (parent) {
                parent.children.push(node);
                parent.isLeaf = false;
            } else {
                // Parent missing, treat as root
                roots.push(node);
            }
        } else {
            roots.push(node);
        }
    });

    return roots;
}

export function calculateLayout(roots: TreeNode[]): TreeLayout {
    // Simple Reingold-Tilford-like algorithm or just simple recursive layout
    // Since we want top-down, we can assign Y based on depth.
    // X needs to be calculated to avoid overlap.

    // We'll flatten the list of nodes for the result
    const allNodes: TreeNode[] = [];

    let currentX = 0;
    let maxY = 0;

    function layoutNode(node: TreeNode, depth: number): number {
        node.y = depth * (NODE_HEIGHT + VERTICAL_GAP);
        if (node.y + NODE_HEIGHT > maxY) maxY = node.y + NODE_HEIGHT;

        allNodes.push(node);

        if (node.children.length === 0) {
            node.x = currentX;
            currentX += NODE_WIDTH + HORIZONTAL_GAP;
            return node.x + NODE_WIDTH / 2;
        } else {
            let childCenterXSum = 0;
            node.children.forEach(child => {
                childCenterXSum += layoutNode(child, depth + 1);
            });

            const averageChildCenter = childCenterXSum / node.children.length;
            node.x = averageChildCenter - NODE_WIDTH / 2;

            // Shift if we overlap with previous siblings/subtrees?
            // The simple recursive "currentX" approach guarantees no overlap for leaves,
            // and parents are centered above children.
            // However, if a parent is centered, it might overlap with a neighbor node on the same level
            // if the subtrees are narrow but the parents are close.
            // But since we increment currentX only at leaves, the width of a subtree is determined by its leaves.
            // So parents should generally be fine unless they are wider than their children's bounding box.
            // Here NODE_WIDTH is constant.

            return node.x + NODE_WIDTH / 2;
        }
    }

    // Layout each root tree side-by-side
    roots.forEach(root => {
        layoutNode(root, 0);
        currentX += HORIZONTAL_GAP; // Gap between trees
    });

    // Normalize X to start at 0 (if negative due to centering)
    const minX = Math.min(...allNodes.map(n => n.x));
    if (minX < 0) {
        const offset = -minX + HORIZONTAL_GAP;
        allNodes.forEach(n => n.x += offset);
        currentX += offset;
    }

    return {
        nodes: allNodes,
        width: currentX,
        height: maxY + VERTICAL_GAP
    };
}
