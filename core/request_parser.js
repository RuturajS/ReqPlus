// Request Parser – Parses raw HTTP request strings and structured request objects
export class RequestParser {

    // Parse a raw HTTP request string into a structured object
    static parseRaw(raw) {
        const lines = raw.split(/\r?\n/);
        if (!lines.length) return null;

        const [method, path, httpVersion] = (lines[0] || '').split(/\s+/);
        const headers = {};
        let bodyStart = -1;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line === '') {
                bodyStart = i + 1;
                break;
            }
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const key = line.slice(0, colonIdx).trim().toLowerCase();
                const val = line.slice(colonIdx + 1).trim();
                headers[key] = val;
            }
        }

        const body = bodyStart > 0 ? lines.slice(bodyStart).join('\n') : '';
        const host = headers['host'] || '';
        const url = host ? `https://${host}${path}` : path;

        const parsed = new URL(url.startsWith('http') ? url : `https://placeholder${url}`);
        const params = {};
        parsed.searchParams.forEach((v, k) => { params[k] = v; });

        return {
            method: method?.toUpperCase() || 'GET',
            url,
            path: parsed.pathname,
            host,
            params,
            headers,
            body,
            httpVersion: httpVersion || 'HTTP/1.1'
        };
    }

    // Convert a structured request object to a raw HTTP string
    static toRaw(req) {
        const url = req.url ? new URL(req.url) : null;
        const pathWithQuery = url
            ? `${url.pathname}${url.search}`
            : (req.path || '/');

        const lines = [`${req.method || 'GET'} ${pathWithQuery} HTTP/1.1`];
        const headers = req.headers || {};

        for (const [k, v] of Object.entries(headers)) {
            lines.push(`${k}: ${v}`);
        }

        if (req.body) {
            lines.push('');
            lines.push(req.body);
        } else {
            lines.push('');
        }

        return lines.join('\r\n');
    }

    // Parse URL params from a query string
    static parseParams(queryString) {
        const params = {};
        new URLSearchParams(queryString).forEach((v, k) => {
            params[k] = v;
        });
        return params;
    }

    // Try to format body content
    static formatBody(body, contentType = '') {
        if (!body) return { formatted: '', type: 'empty' };

        if (contentType.includes('json') || this._looksLikeJson(body)) {
            try {
                const obj = JSON.parse(body);
                return { formatted: JSON.stringify(obj, null, 2), type: 'json', parsed: obj };
            } catch (_) { }
        }

        if (contentType.includes('x-www-form-urlencoded') || this._looksLikeForm(body)) {
            const params = this.parseParams(body);
            return { formatted: body, type: 'form', parsed: params };
        }

        if (contentType.includes('xml') || body.trim().startsWith('<')) {
            return { formatted: this._formatXml(body), type: 'xml' };
        }

        return { formatted: body, type: 'text' };
    }

    static _looksLikeJson(str) {
        const t = str.trim();
        return (t.startsWith('{') && t.endsWith('}')) ||
            (t.startsWith('[') && t.endsWith(']'));
    }

    static _looksLikeForm(str) {
        return /^[\w%+.-]+=[\w%+.-]*(&[\w%+.-]+=[\w%+.-]*)*$/.test(str.trim());
    }

    static _formatXml(xml) {
        let formatted = '';
        let indent = 0;
        xml.split(/>\s*</).forEach(node => {
            if (node.match(/^\/\w/)) indent--;
            formatted += '  '.repeat(Math.max(0, indent)) + '<' + node + '>\n';
            if (node.match(/^<?\w[^/]*[^/]$/) && !node.startsWith('?')) indent++;
        });
        return formatted.replace(/^\s*/, '').replace(/(<[^/][^>]*[^/]>)\s*\n\s*(<\/)/g, '$1$2');
    }

    // Extract all headers as structured key-value from string
    static parseHeaders(headerStr) {
        const headers = {};
        for (const line of headerStr.split(/\r?\n/)) {
            const idx = line.indexOf(':');
            if (idx > 0) {
                headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
            }
        }
        return headers;
    }

    // Encode body to appropriate format
    static encodeBody(data, type = 'raw') {
        if (type === 'json') return JSON.stringify(data);
        if (type === 'form') return new URLSearchParams(data).toString();
        return String(data);
    }
}
