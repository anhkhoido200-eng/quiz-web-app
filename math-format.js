/* Shared math/physics notation normalizer.
 *
 * Question text may remain a string, or use the compatible structured form:
 *   { "text": "3/10", "math": "\\frac{3}{10}" }
 * The optional `math`/`latex`/`formula` value is rendered when present; the
 * existing `text` value remains the fallback for old question banks.
 */
(function (global) {
    'use strict';

    const SUPERSCRIPTS = {
        '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
        '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
        '⁺': '+', '⁻': '-', '⁽': '(', '⁾': ')'
    };
    const SUPERSCRIPT_PATTERN = '[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+';
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

    function latexAtom(value) {
        return String(value)
            .replace(new RegExp(`(${SUPERSCRIPT_PATTERN})`, 'g'), (match) => `^{${[...match].map((char) => SUPERSCRIPTS[char]).join('')}}`)
            .replace(/([A-Za-zα-ωΑ-Ω])\^(\d+)/g, '$1^{$2}');
    }

    function format(value) {
        const input = readValue(value);
        if (!input.text) return '';
        if (input.explicitMath) return withInlineMath(input.text);

        let source = input.text;
        const tokens = [];

        // Never rewrite an explicitly supplied LaTeX block.
        source = protectMathBlocks(source, tokens);

        // Numeric and simple symbolic fractions. This covers old text such as
        // 3/10, 1 / 2π, v²/ω⁴, and g / ℓ without changing the card layout.
        source = source.replace(/\b(cm|km|m)\s*\/\s*s([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/gu, (_, unit, exponent) => `$\\frac{\\text{${unit}}}{\\text{s}^{${[...exponent].map((char) => SUPERSCRIPTS[char]).join('')}}}$`);
        source = source.replace(/(?<![\w.\/α-ωΑ-Ω])(\d+)\s*\/\s*(\d+)(?![\w.\/α-ωΑ-Ω])/g, (match, numerator, denominator, offset, whole) => {
            // Keep calendar dates and multi-part slash sequences unchanged.
            if (/\/\s*$/.test(whole.slice(0, offset)) || /^\s*\//.test(whole.slice(offset + match.length))) return match;
            return `$\\frac{${numerator}}{${denominator}}$`;
        });
        const atom = '(?:\\d+(?:[.,]\\d+)?[A-Za-zα-ωΑ-Ω]?|[A-Za-zα-ωΑ-Ω](?:\\^?\\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)';
        source = source.replace(new RegExp(`(?<![\\w./])(${atom})\\s*\\/\\s*(${atom})(?![\\w./])`, 'gu'), (_, numerator, denominator) => `$\\frac{${latexAtom(numerator)}}{${latexAtom(denominator)}}$`);

        // Protect generated fractions before applying the remaining notation
        // rules so their LaTeX commands cannot be rewritten as plain text.
        source = protectMathBlocks(source, tokens);

        // Geometry, chemistry, implication, comparison, and sign symbols.
        source = source.replace(/(?:([A-Z]{2}|d\d?|\([A-Za-zα-ωΑ-Ω]\))\s*\/\/\s*([A-Z]{2}|d\d?|\([A-Za-zα-ωΑ-Ω]\)))/g, '$1 $\\parallel$ $2');
        source = source.replace(/\s*(?:\/{2,3}|<=>|<->|⇌|⇄)\s*/g, ' $\\rightleftharpoons$ ');
        source = source.replace(/\s*(?:-{1,3}>|──>|⟶)\s*/g, ' $\\rightarrow$ ');
        source = source.replace(/\s*=>\s*/g, ' $\\Rightarrow$ ');
        source = source.replace(/\s*>=\s*/g, ' $\\ge$ ');
        source = source.replace(/\s*<=\s*/g, ' $\\le$ ');
        source = source.replace(/\s*!=\s*/g, ' $\\ne$ ');
        source = source.replace(/\s*\+-\s*/g, ' $\\pm$ ');

        // Chemistry and thermodynamics.
        source = source.replace(/(?:Delta|Δ)\s*([rR])\s*H(?:\s*298)?(?:\s*\^?0)?/g, '$\\Delta_r H_{298}^\\circ$');
        source = protectMathBlocks(source, tokens);
        source = source.replace(/(?<!\\)(?:Delta|Δ)\s*H/g, '$\\Delta H$');
        source = protectMathBlocks(source, tokens);
        source = source.replace(/(?<!\\)(?:Delta|Δ)/g, '$\\Delta$');
        source = protectMathBlocks(source, tokens);
        source = source.replace(/\bK[Cc]\b/g, '$K_C$');
        source = source.replace(/\bK[Pp]\b/g, '$K_p$');

        // Units and common chemical formulas. Use a real fraction for rates.
        source = source.replace(/(\d+)\s*(?:°C|\^oC|\*C)/g, (_, number) => `$${number}^{\\circ}\\text{C}$`);
        source = source.replace(/\b(m|cm|km)\/s\^?2\b/g, (_, unit) => `$\\frac{\\text{${unit}}}{\\text{s}^2}$`);
        source = source.replace(/\b(cm|km|m)\/s([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/gu, (_, unit, exponent) => `$\\frac{\\text{${unit}}}{\\text{s}^{${[...exponent].map((char) => SUPERSCRIPTS[char]).join('')}}}$`);
        source = source.replace(/\b(km|cm|dm|mm|m)\^?2\b/g, (_, unit) => `$\\text{${unit}}^2$`);
        source = source.replace(/\b(km|cm|dm|mm|m)\^?3\b/g, (_, unit) => `$\\text{${unit}}^3$`);
        const chemicalFormulae = {
            H2O: '$\\text{H}_2\\text{O}$', CO2: '$\\text{CO}_2$', H2SO4: '$\\text{H}_2\\text{SO}_4$',
            CaCO3: '$\\text{CaCO}_3$', SO2: '$\\text{SO}_2$', NH3: '$\\text{NH}_3$', N2: '$\\text{N}_2$',
            O2: '$\\text{O}_2$', H2: '$\\text{H}_2$', Cl2: '$\\text{Cl}_2$', I2: '$\\text{I}_2$',
            Fe2O3: '$\\text{Fe}_2\\text{O}_3$', Al2O3: '$\\text{Al}_2\\text{O}_3$', BaSO4: '$\\text{BaSO}_4$'
        };
        Object.entries(chemicalFormulae).forEach(([formula, replacement]) => {
            source = source.replace(new RegExp(`\\b${formula}\\b`, 'g'), replacement);
        });

        // Preserve Unicode superscripts already displaying correctly.
        source = protectMathBlocks(source, tokens);
        source = source.replace(/(?<![\w$])([A-Za-zα-ωΑ-Ω])\^(\d+)(?!\w)/g, (_, base, exponent) => `$${base}^{${exponent}}$`);

        return restoreMathBlocks(source, tokens);
    }

    global.MathNotation = { format, readValue };
})(typeof window !== 'undefined' ? window : globalThis);
