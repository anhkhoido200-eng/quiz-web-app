/* Shared math/physics notation normalizer.
 *
 * Question text may remain a string, or use the compatible structured form:
 *   { "text": "3/10", "math": "\\frac{3}{10}" }
 * The optional `math`/`latex`/`formula` value is rendered when present; the
 * existing `text` value remains the fallback for old question banks.
 */
(function (global) {
    'use strict';

    const TO_SUPERSCRIPT = {
        '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
        '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
        '+': '⁺', '-': '⁻', '(': '⁽', ')': '⁾'
    };
    const MATH_BLOCK_PATTERN = /(\$\$[\s\S]*?\$\$|\$[^$]+?\$)/g;

    function readValue(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { text: value == null ? '' : String(value), explicitMath: false };
        }

        const math = value.math ?? value.latex ?? value.formula;
        if (math !== undefined && math !== null && String(math).trim()) {
            return { text: String(math), explicitMath: true };
        }

        return {
            text: String(value.text ?? value.value ?? value.content ?? ''),
            explicitMath: false
        };
    }

    function withInlineMath(value) {
        const source = String(value || '').trim();
        if (!source) return '';
        if (/^\$\$[\s\S]*\$\$$/.test(source) || /^\$[^$]+\$$/.test(source)) return source;
        return `$${source}$`;
    }

    function protectMathBlocks(value, tokens) {
        return value.replace(MATH_BLOCK_PATTERN, (match) => {
            tokens.push(match);
            return `___MATH_TOKEN_${tokens.length - 1}___`;
        });
    }

    function restoreMathBlocks(value, tokens) {
        return value.replace(/___MATH_TOKEN_(\d+)___/g, (match, index) => tokens[Number(index)] ?? match);
    }

    function toSuperscript(value) {
        return [...String(value)].map((char) => TO_SUPERSCRIPT[char] ?? char).join('');
    }

    function escapeHtmlOutsideMath(value) {
        return value
            .replace(/&(?!(?:amp|lt|gt|quot|#39|#x27);)/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function format(value) {
        const input = readValue(value);
        if (!input.text) return '';
        if (input.explicitMath) return withInlineMath(input.text);

        let source = input.text;
        const tokens = [];

        // Never rewrite an explicitly supplied LaTeX block ($...$ or $$...$$).
        source = protectMathBlocks(source, tokens);

        // Geometry, chemistry, implication, comparison, and sign symbols -> Unicode.
        source = source.replace(/(?:([A-Z]{2}|d\d?|\([A-Za-zα-ωΑ-Ω]\))\s*\/\/\s*([A-Z]{2}|d\d?|\([A-Za-zα-ωΑ-Ω]\)))/g, '$1 ∥ $2');
        source = source.replace(/\s*(?:\/{2,3}|<=>|<->|⇌|⇄)\s*/g, ' ⇔ ');
        source = source.replace(/\s*(?:-{1,3}>|──>|⟶)\s*/g, ' → ');
        source = source.replace(/\s*=>\s*/g, ' ⇒ ');
        source = source.replace(/\s*>=\s*/g, ' ≥ ');
        source = source.replace(/\s*<=\s*/g, ' ≤ ');
        source = source.replace(/\s*!=\s*/g, ' ≠ ');
        source = source.replace(/\s*\+-\s*/g, ' ± ');

        // Chemistry and thermodynamics -> Unicode.
        source = source.replace(/(?:Delta|Δ)\s*([rR])\s*H(?:\s*298)?(?:\s*\^?0)?/g, 'ΔᵣH°₂₉₈');
        source = source.replace(/(?<!\\)(?:Delta|Δ)\s*H\b/g, 'ΔH');
        source = source.replace(/(?<!\\)\bDelta\b/g, 'Δ');

        // Units and common chemical formulas -> Unicode.
        source = source.replace(/(\d+)\s*(?:°C|\^oC|\*C)/g, '$1°C');
        source = source.replace(/\b(cm|km|m)\s*\/\s*s\^?2\b/g, '$1/s²');
        source = source.replace(/\b(cm|km|m)\s*\/\s*s([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/gu, '$1/s$2');
        source = source.replace(/\b(km|cm|dm|mm|m)\^?2\b/g, '$1²');
        source = source.replace(/\b(km|cm|dm|mm|m)\^?3\b/g, '$1³');

        const chemicalFormulae = {
            H2O: 'H₂O', CO2: 'CO₂', H2SO4: 'H₂SO₄',
            CaCO3: 'CaCO₃', SO2: 'SO₂', NH3: 'NH₃', N2: 'N₂',
            O2: 'O₂', H2: 'H₂', Cl2: 'Cl₂', I2: 'I₂',
            Fe2O3: 'Fe₂O₃', Al2O3: 'Al₂O₃', BaSO4: 'BaSO₄'
        };
        Object.entries(chemicalFormulae).forEach(([formula, replacement]) => {
            source = source.replace(new RegExp(`\\b${formula}\\b`, 'g'), replacement);
        });

        // Convert plain caret exponents (e.g. x^2, 10^-3) to Unicode superscripts.
        source = source.replace(/(?<![\w$])([A-Za-zα-ωΑ-Ω]|\d+)\^([+-]?\d+)(?!\w)/g, (_, base, exponent) => `${base}${toSuperscript(exponent)}`);

        // Escape &, <, > outside explicit $...$ blocks so expressions like "v < 0" or "A > 0" are never swallowed by HTML parsing.
        source = escapeHtmlOutsideMath(source);

        return restoreMathBlocks(source, tokens);
    }

    global.MathNotation = { format, readValue };
})(typeof window !== 'undefined' ? window : globalThis);
