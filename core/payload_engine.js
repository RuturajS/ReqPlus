// Payload Engine – Manages payload sets for Intruder attacks
export class PayloadEngine {

    // No built-in payloads for minimal footprint
    static BUILT_IN = {};

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
