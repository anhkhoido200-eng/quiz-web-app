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

    function escapeHtmlUnsafe(value) {
        return String(value ?? '')
            .replace(/&(?!(?:amp|lt|gt|quot|#39|#x27|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function withInlineMath(value) {
        const source = String(value || '').trim();
        if (!source) return '';
        if (/\$\$[\s\S]*?\$\$|\$[^$]+?\$/.test(source)) return source;
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
            .replace(/([A-Za-zα-ωΑ-Ωℓ])\^(\d+)/g, '$1^{$2}');
    }

    function format(value) {
        const input = readValue(value);
        if (!input.text) return '';
        if (input.explicitMath) return escapeHtmlUnsafe(withInlineMath(input.text));

        let source = input.text;
        const tokens = [];

        // Never rewrite an explicitly supplied LaTeX block.
        source = protectMathBlocks(source, tokens);

        // Unit rates such as m/s^2, cm/s², km/s^2 before generic symbolic fractions.
        source = source.replace(/(?<![A-Za-zÀ-ỹ])(cm|km|m)\s*\/\s*s([⁰¹²³⁴⁵⁶⁷⁸⁹]+|\^?\d+)(?![A-Za-z0-9À-ỹ⁰¹²³⁴⁵⁶⁷⁸⁹])/gu, (_, unit, exponent) => {
            const exp = exponent.startsWith('^')
                ? exponent.slice(1)
                : [...exponent].map((char) => SUPERSCRIPTS[char] ?? char).join('');
            return `$\\frac{\\text{${unit}}}{\\text{s}^{${exp}}}$`;
        });
        source = protectMathBlocks(source, tokens);

        // Numeric and simple symbolic fractions. This covers old text such as
        // 3/10, 1 / 2π, v²/ω⁴, 1 / 0,4, 2,5 / 3,6, and g / ℓ without cutting
        // Vietnamese decimals or multi-part slash expressions (e.g. USD/người/năm).
        source = source.replace(/(?<![\p{L}\p{N}_/])(?<!\d[.,])(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)(?![\p{L}\p{N}_/])(?![.,]\d)/gu, (match, numerator, denominator, offset, whole) => {
            // Keep calendar dates and multi-part slash sequences unchanged.
            const before = whole.slice(0, offset);
            const after = whole.slice(offset + match.length);
            const timeWord = /(?:ngày|tháng|mùng|đêm|sáng|chiều|tối|hôm|dịp|đợt|lễ|kỷ niệm|chiến dịch)\s*$/iu.test(before);
            const numeratorNumber = Number(numerator.replace(',', '.'));
            const dateLike = /^(1[0-9]{3}|20[0-9]{2})$/.test(denominator)
                && /^\d+$/.test(numerator)
                && numeratorNumber >= 1 && numeratorNumber <= 31
                && !/[=+\-*^]\s*$/.test(before)
                && !/^\s*[=+\-*^]/.test(after);
            const dayMonth = /^\d+$/.test(numerator) && /^\d+$/.test(denominator)
                && numeratorNumber >= 13 && numeratorNumber <= 31
                && Number(denominator) >= 1 && Number(denominator) <= 12;
            if (numerator === '24' && denominator === '7' || timeWord || dateLike || dayMonth
                || /\/\s*$/.test(before) || /^\s*\//.test(after)) return match;
            return `$\\frac{${numerator}}{${denominator}}$`;
        });
        source = protectMathBlocks(source, tokens);

        // Physical and chemical units must stay textual, not become symbolic fractions.
        source = source.replace(/(?<![A-Za-zÀ-ỹ\d])((?:km|m|cm|mm))\s*\/\s*(h|s|phút|giờ)|(?<![A-Za-zÀ-ỹ\d])(g|kg)\s*\/\s*(cm|m)\s*3|(?<![A-Za-zÀ-ỹ\d])g\s*\/\s*mol/giu, (match, speedUnit, speedDenominator, densityUnit, densityDenominator) => {
            if (speedUnit) return `$\\text{${speedUnit}}/\\text{${speedDenominator}}$`;
            if (densityUnit) return `$\\text{${densityUnit}}/\\text{${densityDenominator}}^3$`;
            return '$\\text{g}/\\text{mol}$';
        });
        source = protectMathBlocks(source, tokens);

        const atom = '(?:\\d+(?:[.,]\\d+)?[A-Za-zα-ωΑ-Ωℓ]?|[A-Za-zα-ωΑ-Ωℓ](?:_[A-Za-z0-9]+)?(?:\\^?\\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)';
        source = source.replace(new RegExp(`(?<![\\p{L}\\p{N}_/])(?<!\\d[.,])(${atom})\\s*\\/\\s*(${atom})(?![\\p{L}\\p{N}_/])(?![.,]\\d)`, 'gu'), (match, numerator, denominator, offset, whole) => {
            if (/^\d+(?:[.,]\d+)?$/.test(numerator) && /^\d+(?:[.,]\d+)?$/.test(denominator)) return match;
            if (/\/\s*$/.test(whole.slice(0, offset)) || /^\s*\//.test(whole.slice(offset + match.length))) return match;
            return `$\\frac{${latexAtom(numerator)}}{${latexAtom(denominator)}}$`;
        });

        // Protect generated fractions before applying the remaining notation
        // rules so their LaTeX commands cannot be rewritten as plain text.
        source = protectMathBlocks(source, tokens);

        // Geometry, chemistry, implication, comparison, and sign symbols.
        source = source.replace(/(?:([A-Z]{2}|d\d?|\([A-Za-zα-ωΑ-Ω]\))\s*\/\/\s*([A-Z]{2}|d\d?|\([A-Za-zα-ωΑ-Ω]\)))/g, '$1 $\\parallel$ $2');
        source = source.replace(/\s*(?:(?<!:)\/{3}|<=>|<->|⇌|⇄)\s*/g, ' $\\rightleftharpoons$ ');
        source = source.replace(/\s*(?:-{1,3}>|──>|⟶)\s*/g, ' $\\rightarrow$ ');
        source = source.replace(/\s*=>\s*/g, ' $\\Rightarrow$ ');
        source = source.replace(/\s*>=\s*/g, ' $\\ge$ ');
        source = source.replace(/\s*<=\s*/g, ' $\\le$ ');
        source = source.replace(/\s*!=\s*/g, ' $\\ne$ ');
        source = source.replace(/\s*\+-\s*/g, ' $\\pm$ ');

        // Chemistry and thermodynamics.
        source = source.replace(/(?:\bDelta\b|Δ)\s*([rR])\s*H(?:\s*298)?(?:\s*\^?0)?/g, '$\\Delta_r H_{298}^\\circ$');
        source = protectMathBlocks(source, tokens);
        source = source.replace(/(?<!\\)(?:\bDelta\b|Δ)\s*H/g, '$\\Delta H$');
        source = protectMathBlocks(source, tokens);
        source = source.replace(/(?<!\\)(?:\bDelta\b|Δ)/g, (match, offset, whole) => {
            const before = whole.slice(0, offset);
            if (match === 'Delta' && /(?:^|\s)(?:[A-Z][A-Za-zÀ-ỹ-]*)\s$/.test(before)
                && !/[=+\-*/^]\s*$/.test(before)) return match;
            return '$\\Delta$';
        });
        source = protectMathBlocks(source, tokens);
        source = source.replace(/\bK[Cc]\b/g, '$K_C$');
        source = source.replace(/\bK[Pp]\b/g, '$K_p$');

        // Units and common chemical formulas.
        source = source.replace(/(\d+(?:[.,]\d+)?)\s*(?:°C|\^oC|\*C)/g, (_, number) => `$${number}^{\\circ}\\text{C}$`);
        source = source.replace(/(?<![A-Za-zÀ-ỹ])(km|cm|dm|mm|m)\^([23])(?![A-Za-z0-9À-ỹ])/gu, (_, unit, exponent) => `$\\text{${unit}}^${exponent}$`);
        source = source.replace(/(?<=\d\s)(km|cm|dm|mm|m)([23])(?![A-Za-z0-9À-ỹ])/gu, (_, unit, exponent) => `$\\text{${unit}}^${exponent}$`);
        source = source.replace(/([/(]\s*)(km|cm|dm|mm|m)([23])(?![A-Za-z0-9À-ỹ])/gu, (_, prefix, unit, exponent) => `${prefix}$\\text{${unit}}^${exponent}$`);
        const chemicalFormulae = {
            H2O: '$\\text{H}_2\\text{O}$', CO2: '$\\text{CO}_2$', H2SO4: '$\\text{H}_2\\text{SO}_4$',
            CaCO3: '$\\text{CaCO}_3$', SO2: '$\\text{SO}_2$', NH3: '$\\text{NH}_3$', N2: '$\\text{N}_2$',
            O2: '$\\text{O}_2$', H2: '$\\text{H}_2$', Cl2: '$\\text{Cl}_2$', I2: '$\\text{I}_2$',
            Fe2O3: '$\\text{Fe}_2\\text{O}_3$', Al2O3: '$\\text{Al}_2\\text{O}_3$', BaSO4: '$\\text{BaSO}_4$'
        };
        Object.entries(chemicalFormulae).forEach(([formula, replacement]) => {
            source = source.replace(new RegExp(`(?<![A-Za-zÀ-ỹ])(\\d*)(${formula})\\b`, 'g'), (_, coefficient) => `${coefficient}${replacement}`);
        });

        // Preserve Unicode superscripts already displaying correctly.
        source = protectMathBlocks(source, tokens);
        source = source.replace(/(?<![\w$])([A-Za-z0-9α-ωΑ-Ωℓ]+)\^(-?\d+)(?!\w)/g, (match, base, exponent, offset, whole) => {
            if (/https?:\/\/[^\s]*$/i.test(whole.slice(0, offset))) return match;
            return `$${base}^{${exponent}}$`;
        });
        source = protectMathBlocks(source, tokens);

        // Escape &, <, > across both plain text and math blocks before innerHTML injection to prevent Stored XSS.
        return escapeHtmlUnsafe(restoreMathBlocks(source, tokens));
    }

    global.MathNotation = { format, readValue };
})(typeof window !== 'undefined' ? window : globalThis);
