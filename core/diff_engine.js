// Diff Engine – Compare two text responses for Repeater diff view
export class DiffEngine {

    static diff(a, b) {
        const aLines = (a || '').split('\n');
        const bLines = (b || '').split('\n');
        const lcs = this._lcs(aLines, bLines);
        return this._buildDiff(aLines, bLines, lcs);
    }

    static _lcs(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (a[i - 1] === b[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Reconstruct LCS
        const lcs = [];
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (a[i - 1] === b[j - 1]) {
                lcs.unshift({ ai: i - 1, bi: j - 1 });
                i--; j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        return lcs;
    }

    static _buildDiff(aLines, bLines, lcs) {
        const result = [];
        let ai = 0, bi = 0;

        for (const { ai: la, bi: lb } of lcs) {
            // Lines removed from a
            while (ai < la) {
                result.push({ type: 'removed', line: aLines[ai], lineA: ai + 1 });
                ai++;
            }
            // Lines added in b
            while (bi < lb) {
                result.push({ type: 'added', line: bLines[bi], lineB: bi + 1 });
                bi++;
            }
            // Equal line
            result.push({ type: 'equal', line: aLines[ai], lineA: ai + 1, lineB: bi + 1 });
            ai++; bi++;
        }

        // Remaining removals
        while (ai < aLines.length) {
            result.push({ type: 'removed', line: aLines[ai], lineA: ai + 1 });
            ai++;
        }
        // Remaining additions
        while (bi < bLines.length) {
            result.push({ type: 'added', line: bLines[bi], lineB: bi + 1 });
            bi++;
        }

        return {
            hunks: result,
            stats: {
                added: result.filter(r => r.type === 'added').length,
                removed: result.filter(r => r.type === 'removed').length,
                equal: result.filter(r => r.type === 'equal').length
            }
        };
    }

    // Render diff to HTML string
    static toHTML(diff) {
        const lines = diff.hunks.map(h => {
            const cls = h.type === 'added' ? 'diff-add' :
                h.type === 'removed' ? 'diff-remove' : 'diff-eq';
            const prefix = h.type === 'added' ? '+' :
                h.type === 'removed' ? '-' : ' ';
            const escaped = this._escape(h.line || '');
            return `<div class="diff-line ${cls}"><span class="diff-prefix">${prefix}</span><span class="diff-text">${escaped}</span></div>`;
        });
        return lines.join('');
    }

    static _escape(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
