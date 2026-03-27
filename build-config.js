// Extended build configuration for code signing and advanced options

const isDevelopment = process.env.NODE_ENV === 'development';
const isCI = process.env.CI === 'true';

const config = {
  // Code signing configuration (set these environment variables)
  win: {
    // Windows code signing
    certificateFile: process.env.WIN_CSC_LINK, // Path to .p12 file
    certificatePassword: process.env.WIN_CSC_KEY_PASSWORD,
    // Or use certificateSubjectName and certificateSha1 for installed certificates
    certificateSubjectName: process.env.WIN_CERT_SUBJECT_NAME,
    certificateSha1: process.env.WIN_CERT_SHA1,
    
    // Windows specific settings
    signTool: process.env.WIN_SIGN_TOOL || 'signtool', // or 'jsign'
    signToolPath: process.env.WIN_SIGN_TOOL_PATH, // custom signtool path
    
    // Additional signing parameters
    additionalSigningArgs: [
      '/tr', 'http://timestamp.digicert.com',
      '/td', 'sha256',
      '/fd', 'sha256'
    ]
  },
  
  mac: {
    // macOS code signing
    identity: process.env.MAC_CERT_NAME || 'Developer ID Application: Royal Theaters',
    
    // App Store Connect API (for notarization)
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD, // App-specific password
    appleTeamId: process.env.APPLE_TEAM_ID,
    
    // Or use API Key authentication
    appleApiKey: process.env.APPLE_API_KEY,
    appleApiKeyId: process.env.APPLE_API_KEY_ID,
    appleApiIssuer: process.env.APPLE_API_ISSUER,
    
    // Notarization settings
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.plist',
    entitlementsInherit: 'build/entitlements.plist'
  },
  
  // Build environment settings
  environment: {
    isDevelopment,
    isCI,
    skipCodeSigning: isDevelopment || process.env.SKIP_CODE_SIGNING === 'true',
    skipNotarization: isDevelopment || process.env.SKIP_NOTARIZATION === 'true'
  },
  
  // Publish configuration
  publish: {
    provider: 'github',
    owner: process.env.GITHUB_OWNER || 'carsonmiller31',
    repo: process.env.GITHUB_REPO || 'Royal-Theaters-Systems-Kiosk',
    // No token used; publishing handled via GitHub CLI in scripts
    private: false,
    releaseType: 'release' // 'draft', 'prerelease', 'release'
  }
};

module.exports = config;
