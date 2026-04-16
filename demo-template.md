# Quiz Blocks — Demo Template

Copy the block below into any Obsidian note to try all question types at once.

````md
```quiz-blocks
[
  // ── 1. SINGLE CHOICE ──────────────────────────────────────────────────────
  {
    id: 'demo-1',
    title: 'Single Choice',
    prompt: 'You receive an email from your bank asking you to click a link and confirm your password urgently. What should you do?',
    options: [
      'Click the link and enter your credentials quickly before it expires',
      'Reply to the email asking if it is legitimate',
      'Go directly to your bank website by typing the URL yourself',
      'Forward the email to friends to warn them',
    ],
    correctIndex: 2,
    hint: 'Legitimate banks never ask for your password by email. The safest move avoids the link entirely.',
    explainHtml: '<p>This is a classic <strong>phishing</strong> attack. The email creates urgency to make you act without thinking.</p><ul><li>Never click links in suspicious emails — always type the URL directly in your browser.</li><li>Real banks will never ask for your password via email.</li><li>Replying or forwarding still interacts with the attacker.</li></ul><p>When in doubt, call your bank directly using the number on the back of your card.</p>',
  },

  // ── 2. MULTIPLE CHOICE ────────────────────────────────────────────────────
  {
    id: 'demo-2',
    title: 'Multiple Choice',
    prompt: 'Which of the following are good habits for a strong password? (Select all that apply)',
    options: [
      'Use a different password for every account',
      'Include your date of birth for easy recall',
      'Use a mix of uppercase, lowercase, numbers, and symbols',
      'Use a password manager to store them',
      'Reuse your strongest password on all important sites',
    ],
    multiSelect: true,
    correctIndices: [0, 2, 3],
    hint: 'Personal info and reuse are the two biggest weaknesses. A manager removes the need to remember.',
    explainHtml: '<p>Password security is one of the most impactful habits you can build.</p><ul><li><strong>Different password per account</strong> ✓ — if one site is breached, others stay safe.</li><li><em>Date of birth</em> ✗ — trivially guessable from social media.</li><li><strong>Mix of characters</strong> ✓ — dramatically increases the number of possible combinations.</li><li><strong>Password manager</strong> ✓ — lets you use strong unique passwords without memorizing them.</li><li><em>Reusing passwords</em> ✗ — one breach exposes all your accounts.</li></ul>',
  },

  // ── 3. TEXT INPUT ─────────────────────────────────────────────────────────
  {
    id: 'demo-3',
    title: 'Text Answer',
    prompt: 'In a URL like "https://bank.example.com", what is the part that guarantees the connection is encrypted?',
    type: 'text',
    placeholder: 'Enter the protocol prefix...',
    acceptedAnswers: ['https', 'HTTPS'],
    caseSensitive: false,
    hint: 'Look at the very beginning of the URL — it is one letter longer than the unencrypted version.',
    explainHtml: '<p><strong>HTTPS</strong> (HyperText Transfer Protocol Secure) means the connection between your browser and the server is encrypted using TLS.</p><p>The padlock icon in your browser confirms HTTPS is active. Never enter passwords or card numbers on a plain <code>http://</code> site.</p>',
  },

  // ── 4. CMD COMMAND LINE ───────────────────────────────────────────────────
  {
    id: 'demo-4',
    title: 'Windows CMD',
    prompt: 'Your internet is slow and you want to check if it is a DNS problem. Type the command to test if your PC can reach Google by IP address (8.8.8.8) instead of domain name.',
    type: 'text',
    terminalVariant: 'cmd',
    commandPrefix: 'C:\\>',
    placeholder: 'Enter command here',
    acceptedAnswers: ['ping 8.8.8.8'],
    caseSensitive: false,
    hint: 'Use the most basic connectivity test followed by the IP address.',
    explainHtml: '<p><code>ping 8.8.8.8</code> bypasses DNS and tests raw internet connectivity.</p><ul><li>If it works → your connection is fine, the problem is DNS resolution.</li><li>If it fails → you have no internet access at all.</li></ul><p>This one command helps you narrow down the issue in seconds.</p>',
  },

  // ── 5. POWERSHELL COMMAND LINE ────────────────────────────────────────────
  {
    id: 'demo-5',
    title: 'PowerShell',
    prompt: 'Your Windows PC is running slow. Type the PowerShell command to see all processes currently using CPU and memory.',
    type: 'text',
    terminalVariant: 'powershell',
    commandPrefix: 'PS>',
    placeholder: 'Enter cmdlet here',
    acceptedAnswers: ['Get-Process', 'get-process', 'gps'],
    caseSensitive: false,
    hint: 'It is the PowerShell equivalent of opening the Task Manager from the command line.',
    explainHtml: '<p><code>Get-Process</code> lists all running processes with their CPU and memory usage — the CLI equivalent of Task Manager.</p><p>Useful tip: pipe it to sort by CPU usage with <code>Get-Process | Sort-Object CPU -Descending | Select-Object -First 10</code></p>',
  },

  // ── 6. BASH COMMAND LINE ──────────────────────────────────────────────────
  {
    id: 'demo-6',
    title: 'Linux Bash',
    prompt: 'You just downloaded a suspicious file and want to check how much disk space it takes. Type the Linux command to see the size of a file or folder called "downloads".',
    type: 'text',
    terminalVariant: 'bash',
    placeholder: 'Enter command here',
    acceptedAnswers: ['du -sh downloads', 'du -hs downloads'],
    caseSensitive: false,
    hint: 'The command is "disk usage". Use the flag for human-readable sizes and the flag for a summary.',
    explainHtml: '<p><code>du -sh downloads</code> shows the total disk usage of the "downloads" folder in a human-readable format (KB, MB, GB).</p><ul><li><code>-s</code> — summary (total only, no subdirectory breakdown).</li><li><code>-h</code> — human-readable (shows MB/GB instead of raw bytes).</li></ul>',
  },

  // ── 7. ORDERING (drag & drop) ─────────────────────────────────────────────
  {
    id: 'demo-7',
    title: 'Ordering',
    prompt: 'You want to push code to GitHub. Put these Git steps in the correct order.',
    ordering: true,
    slots: ['1st', '2nd', '3rd', '4th'],
    possibilities: [
      'git push',
      'git add .',
      'git commit -m "message"',
      'Make changes to your files',
    ],
    correctOrder: [3, 1, 2, 0],
    hint: 'You have to make changes before you can track them, stage before you commit, and commit before you push.',
    explainHtml: '<p>The standard Git workflow for publishing changes:</p><ol><li><strong>Make changes</strong> — edit your files.</li><li><strong>git add .</strong> — stage all changed files.</li><li><strong>git commit -m</strong> — save a snapshot with a message.</li><li><strong>git push</strong> — upload commits to GitHub.</li></ol>',
  },

  // ── 8. MATCHING (pair columns) ────────────────────────────────────────────
  {
    id: 'demo-8',
    title: 'Matching',
    prompt: 'Match each HTTP status code with what it means.',
    matching: true,
    rows: ['200', '404', '403', '500'],
    choices: [
      'Forbidden — you do not have permission',
      'Internal Server Error — something broke on the server',
      'Not Found — the page does not exist',
      'OK — the request succeeded',
    ],
    correctMap: [3, 2, 0, 1],
    hint: '2xx = success, 4xx = client error, 5xx = server error.',
    explainHtml: '<ul><li><strong>200 OK</strong>: the request was successful and the server returned the content.</li><li><strong>404 Not Found</strong>: the URL exists but the resource does not — classic broken link.</li><li><strong>403 Forbidden</strong>: the server understood the request but refuses to authorize it.</li><li><strong>500 Internal Server Error</strong>: something went wrong on the server side, not your fault.</li></ul>',
  },

  // ── MODE CONFIG ─────────────────────────────────────────────────────────────
  // Uncomment one of the following config blocks to change the quiz mode:

  // Exam mode (timed quiz, locked after time up)
  // {
  //   mode: "exam",
  //   examDurationMinutes: 8,
  //   examAutoSubmit: true,
  //   examShowTimer: true,
  // },

  // Learn mode (lessons before each question, no timer)
  // {
  //   mode: "learn",
  // },

  // Learn mode with exam transition (lessons first, then "Passer l'examen" button)
  // {
  //   mode: "learn",
  //   examDurationMinutes: 10,
  //   examAutoSubmit: true,
  //   examShowTimer: true,
  // },

  // Shorthands: { examMode: true } = mode: "exam", { learnMode: true } = mode: "learn"
]
```
````

---

## Learn Mode

````md
```quiz-blocks
[
  {
    title: "Système d'information",
    prompt: "Un SI est composé de quelles ressources principales ?",
    options: [
      "Uniquement de logiciels",
      "Matériel, logiciels, données, procédures et personnes",
      "Seulement du matériel informatique",
      "Des données et des réseaux uniquement",
    ],
    correctIndex: 1,
    learn: "Un système d'information (SI) est un ensemble organisé de ressources : matériel, logiciels, données, procédures et personnes. Le SI permet de collecter, stocker, traiter et distribuer l'information nécessaire au fonctionnement d'une organisation. Les 5 composantes sont interdépendantes et doivent être cohérentes entre elles.",
  },
  {
    title: "Sécurité — CIA",
    prompt: "Quels sont les trois piliers de la sécurité de l'information ?",
    options: [
      "Confidentialité, Intégrité, Disponibilité",
      "Contrôle, Inspection, Audit",
      "Cryptage, Isolation, Anonymat",
      "Certification, Investigation, Autorisation",
    ],
    correctIndex: 0,
    learn: "Le triade CIA (Confidentialité, Intégrité, Disponibilité) est le modèle fondamental de la sécurité de l'information. La **confidentialité** garantit que seules les personnes autorisées accèdent aux données. L'**intégrité** assure que les données ne sont pas altérées. La **disponibilité** garantit que les ressources sont accessibles quand nécessaire.",
  },
  {
    title: "Réseau — TCP/IP",
    prompt: "Quel protocole assure une livraison fiable des données sur un réseau ?",
    options: [
      "UDP",
      "ICMP",
      "TCP",
      "ARP",
    ],
    correctIndex: 2,
    learn: "TCP (Transmission Control Protocol) est un protocole de transport fiable qui établit une connexion, découpe les données en segments, les numérote, et confirme leur réception. Contrairement à UDP qui envoie sans vérification, TCP garantit que toutes les données arrivent dans l'ordre et sans erreur.",
  },
  {
    mode: "learn",
    examDurationMinutes: 10,
    examAutoSubmit: true,
    examShowTimer: true,
  },
]
```
````
