/**
 * Concurrency Test Script for Timeline Generation
 * Tests how the server handles multiple simultaneous timeline requests
 */

const axios = require('axios').default;

const SERVER_URL = 'http://localhost:8080';
const CONCURRENT_USERS = 10; // Number of simultaneous users to simulate
const TEST_TIMEOUT = 60000; // 60 seconds timeout

// Track results
let results = {
    successful: 0,
    failed: 0,
    queued: 0,
    errors: []
};

async function fetchTimeline(userId) {
    const startTime = Date.now();
    
    try {
        console.log(`🚀 User ${userId}: Requesting timeline...`);
        
        const response = await axios.get(`${SERVER_URL}/api/timeline`, {
            timeout: TEST_TIMEOUT
        });
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
            console.log(`✅ User ${userId}: Timeline received in ${duration}ms (${response.data.length} sessions)`);
            results.successful++;
        } else {
            console.log(`❌ User ${userId}: Invalid timeline data received`);
            results.failed++;
            results.errors.push(`User ${userId}: Invalid timeline data`);
        }
        
    } catch (error) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        if (error.response) {
            console.log(`❌ User ${userId}: HTTP ${error.response.status} in ${duration}ms - ${error.response.data?.error || error.message}`);
            results.failed++;
            results.errors.push(`User ${userId}: HTTP ${error.response.status} - ${error.response.data?.error}`);
        } else if (error.code === 'ECONNABORTED') {
            console.log(`⏰ User ${userId}: Request timed out after ${duration}ms`);
            results.failed++;
            results.errors.push(`User ${userId}: Timeout`);
        } else {
            console.log(`❌ User ${userId}: Network error in ${duration}ms - ${error.message}`);
            results.failed++;
            results.errors.push(`User ${userId}: ${error.message}`);
        }
    }
}

async function checkServerStatus() {
    try {
        const response = await axios.get(`${SERVER_URL}/api/timeline-status`);
        console.log('📊 Server Status:', response.data);
        return response.data;
    } catch (error) {
        console.log('❌ Could not fetch server status:', error.message);
        return null;
    }
}

async function runConcurrencyTest() {
    console.log(`🧪 Starting concurrency test with ${CONCURRENT_USERS} users...`);
    console.log(`📡 Testing server: ${SERVER_URL}`);
    
    // Check initial server status
    await checkServerStatus();
    
    const startTime = Date.now();
    
    // Launch all requests simultaneously
    const promises = [];
    for (let i = 1; i <= CONCURRENT_USERS; i++) {
        promises.push(fetchTimeline(i));
    }
    
    // Wait for all requests to complete
    await Promise.all(promises);
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    // Check final server status
    console.log('\n📊 Final server status:');
    await checkServerStatus();
    
    // Print results
    console.log('\n📋 Test Results:');
    console.log(`Total Users: ${CONCURRENT_USERS}`);
    console.log(`Successful: ${results.successful}`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Total Duration: ${totalDuration}ms`);
    console.log(`Average Time per User: ${totalDuration / CONCURRENT_USERS}ms`);
    
    if (results.errors.length > 0) {
        console.log('\n❌ Errors:');
        results.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    // Performance assessment
    console.log('\n🎯 Performance Assessment:');
    const successRate = (results.successful / CONCURRENT_USERS) * 100;
    console.log(`Success Rate: ${successRate.toFixed(1)}%`);
    
    if (successRate >= 90) {
        console.log('✅ Excellent performance!');
    } else if (successRate >= 70) {
        console.log('⚠️ Good performance, but could be improved');
    } else {
        console.log('❌ Poor performance, investigate server issues');
    }
}

// Handle script interruption
process.on('SIGINT', () => {
    console.log('\n🛑 Test interrupted by user');
    process.exit(0);
});

// Run the test
runConcurrencyTest().catch(error => {
    console.error('💥 Test failed with error:', error);
    process.exit(1);
}); 