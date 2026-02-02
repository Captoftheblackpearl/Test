// Quick validation test for bot setup
import { config } from 'dotenv';
config();

console.log('\n📋 Configuration Test:\n');

// Check required environment variables
const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY'
];

let allSet = true;
required.forEach(key => {
    const value = process.env[key];
    const status = value ? '✅' : '❌';
    const display = value ? `${value.substring(0, 20)}...` : 'NOT SET';
    console.log(`${status} ${key}: ${display}`);
    if (!value) allSet = false;
});

const optional = [
    '__app_id',
    '__initial_auth_token',
    'PORT'
];

console.log('\nOptional:');
optional.forEach(key => {
    const value = process.env[key];
    const display = value || '(using default)';
    console.log(`   ${key}: ${display}`);
});

console.log('\n' + (allSet ? '✅ Ready to deploy!' : '❌ Missing required config. Check .env file.'));
console.log('\nNext steps:');
console.log('1. npm install');
console.log('2. npm start');
console.log('');
