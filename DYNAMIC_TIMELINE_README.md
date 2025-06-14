# Dynamic Timeline Generation

This update enables **automatic generation of fresh, randomized timelines** for each user that visits the site.

## 🎯 **What Changed**

### **Before:**
- All users got the same static `timeline.json` file
- Timeline was manually generated and committed to the repository

### **After:**
- Each user gets a **freshly shuffled timeline** generated on-demand
- Timeline parameters (bandits, demonstrators, zones) are randomly assigned per user
- No two users will have the same experience (unless extremely unlikely)

## 🔧 **How It Works**

1. **User visits site** → Frontend requests timeline from `/api/timeline`
2. **Server receives request** → Automatically runs `models.py` Python script
3. **Python generates timeline** → Outputs fresh JSON with randomized parameters
4. **Server returns timeline** → Frontend loads the unique timeline
5. **User plays game** → With their personalized, randomized experience

## 🛠 **Technical Implementation**

### **New API Endpoint:**
- `GET /api/timeline` - Generates and returns fresh timeline JSON

### **Modified Files:**
- `server.js` - Added timeline generation endpoint with auto-Python detection
- `main.js` - Changed to fetch dynamic timeline instead of static file
- `models.py` - Modified to output JSON to stdout for Node.js capture

### **Fallback System:**
- If Python execution fails → Falls back to static `timeline.json` file
- Robust error handling and timeout protection (30 seconds)
- Auto-detects Python command (`python3`, `python`, or `py`)

## 🧪 **Testing the System**

### **1. Test Python Setup:**
```bash
curl http://localhost:8080/api/test-python
```

### **2. Generate Test Timeline:**
```bash
curl http://localhost:8080/api/timeline
```

### **3. Check Server Logs:**
Look for these messages:
- `🎲 Generating fresh timeline for new user...`
- `🐍 Using Python command: python3`
- `✅ Successfully generated fresh timeline with X sessions`

## 📊 **Benefits**

### **For Researchers:**
- **Better experimental control** - No order effects from repeated timelines
- **Increased statistical power** - Each participant has unique randomization
- **Reproducible** - Session-specific randomization seeds can be logged

### **For Participants:**
- **Fresh experience** - No predictability from shared timelines
- **Improved validity** - Authentic decision-making without prior knowledge

### **For Deployment:**
- **No manual updates** - Timeline generation is automatic
- **Scalable** - Handles multiple concurrent users
- **Robust** - Fallback to static timeline if generation fails

## 🔍 **Monitoring**

### **Server Console Output:**
- Timeline generation requests and results
- Python execution status and timing
- Error details if generation fails

### **Error Handling:**
- Python installation issues → Clear error messages with suggestions
- Script execution failures → Detailed error output for debugging  
- JSON parsing errors → Raw output included for analysis
- Timeout protection → 30-second maximum generation time

## 🚀 **Performance Notes**

- **Generation time:** Typically 1-3 seconds per timeline
- **Memory usage:** Minimal - timeline generated and sent immediately
- **Concurrent users:** Each gets their own Python process
- **Caching:** No caching - fresh generation per user ensures uniqueness

## 📋 **Requirements**

- **Python 3.x** installed and accessible via `python3`, `python`, or `py`
- **Required Python packages:** Already included in the project
- **Node.js packages:** `child_process` (built-in)

## 🔧 **Configuration**

Timeline parameters can be adjusted in `models.py`:
```python
tl = generate_timeline(
    rounds=2, 
    num_play_arm_pulls=6, 
    num_watch_arm_pulls=6
)
```

## 🐛 **Troubleshooting**

### **Common Issues:**

1. **"No working Python installation found"**
   - Install Python 3.x and ensure it's in PATH
   - Test with: `python3 --version` or `python --version`

2. **"Timeline generation timed out"**
   - Check Python dependencies
   - Verify `bandits_data.json` exists and is accessible

3. **"Failed to parse generated timeline"**
   - Check Python script syntax errors
   - Verify JSON output format

### **Debug Steps:**
1. Test Python endpoint: `GET /api/test-python`
2. Check server console for detailed error messages
3. Manually run: `cd timeline_models && python3 models.py`
4. Verify `bandits_data.json` exists and is valid JSON 