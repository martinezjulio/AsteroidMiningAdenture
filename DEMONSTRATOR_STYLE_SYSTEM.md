# Demonstrator Style+Color System

## Overview

The demonstrator system now uses a style+color combination approach where each demonstrator is assigned a unique style (1-6) and color (red, orange, blue, green, yellow, purple) combination from the `assets/demonstrators/styles/` directory.

## Directory Structure

```
assets/demonstrators/styles/
├── style1/
│   ├── red.png
│   ├── orange.png
│   ├── blue.png
│   ├── green.png
│   ├── yellow.png
│   └── purple.png
├── style2/
│   └── ... (same colors)
├── style3/
│   └── ... (same colors)
├── style4/
│   └── ... (same colors)
├── style5/
│   └── ... (same colors)
└── style6/
    └── ... (same colors)
```

Total available combinations: 6 styles × 6 colors = 36 unique demonstrator appearances

## How It Works

### 1. Timeline Analysis
At game initialization, the system:
- Scans the entire timeline to identify all unique `demonstrator_global_index` values
- Identifies which demonstrators appear together in "choice" stages

### 2. Constraint-Based Assignment
The assignment algorithm ensures:

**Constraint 1: Uniqueness (Global)**
- Each demonstrator_global_index gets a unique style+color combination
- Once assigned, that combination is permanently mapped to that demonstrator
- The same demonstrator appearing multiple times always shows the same appearance

**Constraint 2: Session-Level Differentiation**
- Within any given session, if there are multiple demonstrators (different global IDs)
- They are guaranteed to have:
  - **Different styles AND**
  - **Different colors**
- This applies to ALL demonstrators within a session, not just those in choice stages
- This ensures maximum visual distinction between all demonstrators a participant sees in the same session

### 3. Assignment Algorithm
The algorithm:
1. Analyzes timeline to identify which demonstrators appear in which sessions
2. Builds a mapping of session_index → demonstrators that appear in that session
3. Sorts demonstrators by complexity (those appearing in multiple sessions first)
4. For each demonstrator:
   - Tries each style+color combination
   - Checks if it's unused globally (Constraint 1)
   - Checks if the style OR color conflicts with any other demonstrator in ANY session this demonstrator appears in (Constraint 2)
   - Assigns the first valid combination found
5. Logs all assignments and session groupings for debugging

## Example Assignments

For a timeline with:
- Session 1: demonstrators [9, 17]
- Session 2: demonstrators [16, 12]

```javascript
Assignments:
{
  "9": { "style": "style1", "color": "red" },      // In Session 1
  "17": { "style": "style2", "color": "orange" },  // In Session 1
  "16": { "style": "style2", "color": "red" },     // In Session 2
  "12": { "style": "style1", "color": "orange" }   // In Session 2
}
```

Verification:
- **Session 1** [9, 17]: 
  - Demo 9: style1/red
  - Demo 17: style2/orange
  - ✓ Different styles (style1 ≠ style2) AND different colors (red ≠ orange)
  
- **Session 2** [16, 12]:
  - Demo 16: style2/red
  - Demo 12: style1/orange
  - ✓ Different styles (style2 ≠ style1) AND different colors (red ≠ orange)
  
- **Global uniqueness**: All 4 combos are unique ✓

Note: Demo 9 and Demo 16 can share the same color (red) because they appear in different sessions. Same for Demo 17 and Demo 12 sharing orange.

## Code Changes

### Modified Functions

1. **`initializeImageMappings()`**
   - Now calls `analyzeTimelineDemonstrators()` to extract demonstrator relationships
   - Calls `assignDemonstratorStyleColors()` to create the mapping
   - No longer discovers demonstrator images from old `demonstrator_XX.png` format

2. **`getMappedDemonstratorImage(index)`**
   - Returns paths like `styles/style1/blue.png` instead of `demonstrator_05.png`
   - Uses the `demonstratorStyleColorMapping` object
   - Has fallback logic if a demonstrator isn't mapped

3. **`mapDemonstratorImage(demonstratorGlobalIndex)`**
   - Unchanged - still caches and returns mapped images
   - Now returns style+color paths via `getMappedDemonstratorImage()`

### New Functions

1. **`analyzeTimelineDemonstrators(timeline)`**
   - Scans timeline for all demonstrators
   - Groups demonstrators by session_index
   - Returns: `{ allDemonstrators: [...], sessionDemonstrators: {session_index: [...], ...} }`

2. **`assignDemonstratorStyleColors(allDemonstrators, sessionDemonstrators)`**
   - Implements session-level constraint-based assignment algorithm
   - Ensures demonstrators in the same session have different styles AND colors
   - Returns mapping object: `{ demonstrator_index: {style, color} }`
   - Logs assignments and session groupings for debugging

### Image Loading
All image loading paths remain unchanged:
- Phaser: `assets/demonstrators/${mappedImage}`
- DOM: `assets/demonstrators/${imageKey}.png`

Where `mappedImage` is now `styles/style1/blue.png` (returned by the mapping system)

## Benefits

1. **Visual Distinction**: All demonstrators within a session are maximally different (different styles AND colors)
2. **Consistency**: Same demonstrator always looks the same wherever it appears
3. **Scalability**: Supports up to 36 unique demonstrators globally
4. **Session Efficiency**: With N demonstrators per session, can support up to min(6, N) different demonstrators
5. **Flexibility**: Easy to add more styles or colors by adding new folders/images
6. **Automatic**: No manual configuration needed - works with any timeline structure

## Debugging

To see demonstrator assignments, check the browser console during game initialization:
```
Demonstrator Style+Color Assignments: { "9": {...}, "12": {...}, ... }
Session Demonstrators: { "1": [9, 17], "2": [16, 12], ... }
```

This shows:
1. Which style+color combo was assigned to each demonstrator_global_index
2. Which demonstrators appear together in each session

You can verify the constraints by checking:
- Each session's demonstrators have unique styles AND colors
- Each demonstrator has a globally unique combination

