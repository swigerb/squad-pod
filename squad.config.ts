import type { SquadConfig } from '@bradygaster/squad';

/**
 * Squad Configuration for squad-pod
 * 
 */
const config: SquadConfig = {
  version: '1.0.0',
  
  models: {
    defaultModel: 'claude-sonnet-4.5',
    defaultTier: 'standard',
    fallbackChains: {
      premium: ['claude-opus-4.6', 'claude-opus-4.6-fast', 'claude-opus-4.5', 'claude-sonnet-4.5'],
      standard: ['claude-sonnet-4.5', 'gpt-5.2-codex', 'claude-sonnet-4', 'gpt-5.2'],
      fast: ['claude-haiku-4.5', 'gpt-5.1-codex-mini', 'gpt-4.1', 'gpt-5-mini']
    },
    preferSameProvider: true,
    respectTierCeiling: true,
    nuclearFallback: {
      enabled: false,
      model: 'claude-haiku-4.5',
      maxRetriesBeforeNuclear: 3
    }
  },
  
  routing: {
    rules: [
      {
        workType: 'extension-core',
        agents: ['@lisa-simpson'],
        confidence: 'high'
      },
      {
        workType: 'squad-integration',
        agents: ['@lisa-simpson'],
        confidence: 'high'
      },
      {
        workType: 'typescript-build',
        agents: ['@lisa-simpson'],
        confidence: 'high'
      },
      {
        workType: 'react-webview',
        agents: ['@bart-simpson'],
        confidence: 'high'
      },
      {
        workType: 'canvas-pixel-art',
        agents: ['@bart-simpson'],
        confidence: 'high'
      },
      {
        workType: 'feature-dev',
        agents: ['@lisa-simpson', '@bart-simpson'],
        confidence: 'medium'
      },
      {
        workType: 'bug-fix',
        agents: ['@lisa-simpson', '@bart-simpson'],
        confidence: 'medium'
      },
      {
        workType: 'testing',
        agents: ['@marge-simpson'],
        confidence: 'high'
      },
      {
        workType: 'code-review',
        agents: ['@homer-simpson'],
        confidence: 'high'
      },
      {
        workType: 'architecture',
        agents: ['@homer-simpson'],
        confidence: 'high'
      },
      {
        workType: 'documentation',
        agents: ['@ned-flanders'],
        confidence: 'high'
      }
    ],
    governance: {
      eagerByDefault: true,
      scribeAutoRuns: false,
      allowRecursiveSpawn: false
    }
  },
  
  casting: {
    allowlistUniverses: [
      'The Usual Suspects',
      'Breaking Bad',
      'The Wire',
      'Firefly',
      'The Simpsons'
    ],
    overflowStrategy: 'diegetic-expansion',
    universeCapacity: {
      'The Simpsons': 20
    }
  },
  
  platforms: {
    vscode: {
      disableModelSelection: false,
      scribeMode: 'sync'
    }
  }
};

export default config;
