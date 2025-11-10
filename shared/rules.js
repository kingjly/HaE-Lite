export const DEFAULT_RULES = [
  {
    id: 'auth-bearer',
    name: 'Bearer Token',
    pattern: 'Bearer\\s+[A-Za-z0-9\\-\\._~\\+/]+=*',
    category: 'Auth',
    severity: 'medium',
  },
  {
    id: 'api-key',
    name: 'API Key',
    pattern: '(?i)(api[_-]?key|x-api-key)[=:\\s\"\']?([A-Za-z0-9\\-]{16,})',
    category: 'Key',
    severity: 'high',
  },
  {
    id: 'secret-like',
    name: 'Secret-like',
    pattern: '(?i)(secret|password|pwd)[=:\\s\"\']?([A-Za-z0-9!@#$%^&*]{6,})',
    category: 'Secret',
    severity: 'high',
  },
  {
    id: 'jwt',
    name: 'JWT',
    pattern: 'eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+',
    category: 'Auth',
    severity: 'medium',
  },
  {
    id: 'aws-access-key',
    name: 'AWS Access Key',
    pattern: 'AKIA[0-9A-Z]{16}',
    category: 'Key',
    severity: 'high',
  },
];
