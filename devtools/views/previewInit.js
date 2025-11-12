// Preview initializer extracted from Panel to reduce panel.js size
// Fills sample data for preview environment without chrome runtime

export function initPreviewData(panel) {
  const rules = getSampleRules();
  applyRules(panel, rules);
  const requests = getSampleRequests();
  applyRequests(panel, requests);
}

function getSampleRules() {
  return [
    {
      id: 'xss-1',
      name: 'XSS Script Tag',
      category: 'XSS',
      severity: 'high',
      pattern: '(?i)(<script[\\s\\S]*?>)',
      scope: 'response body',
    },
    {
      id: 'sql-1',
      name: 'SQL Keyword',
      category: 'SQLi',
      severity: 'medium',
      pattern: '(?i)(SELECT|INSERT|UPDATE|DELETE)',
      scope: 'request',
    },
    {
      id: 'csrf-1',
      name: 'CSRF Token Missing',
      category: 'CSRF',
      severity: 'low',
      pattern: 'csrf_token=.*',
      scope: 'any header',
    },
  ];
}

function applyRules(panel, rules) {
  panel.rules = rules;
  panel.enabledRuleIds = new Set(['xss-1', 'sql-1']);
  panel.renderRules();
}

function getSampleRequests() {
  return [
    {
      url: 'https://example.com/api/search?q=%3Cscript%3Ealert(1)%3C/script%3E',
      method: 'GET',
      statusCode: 200,
      headers: {},
      body: '',
      timestamp: Date.now(),
      matches: [
        {
          category: 'XSS',
          severity: 'high',
          matched: '<script>alert(1)</script>',
          ruleName: 'XSS Script Tag',
          context: 'query string',
        },
      ],
      categories: ['XSS'],
    },
    {
      url: 'https://example.com/login',
      method: 'POST',
      statusCode: 302,
      headers: {},
      body: 'username=test&password=123',
      timestamp: Date.now() - 5000,
      matches: [],
      categories: [],
    },
  ];
}

function applyRequests(panel, requests) {
  panel.requests = requests;
  panel.renderRequests(panel.requests);
}
