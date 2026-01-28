export const getBrandingScript = () => String.raw`
(function __extractBrandDesign() {
  const errors = [];
  const recordError = (context, error) => {
    errors.push({
      context: context,
      message: error && error.message ? error.message : String(error),
      timestamp: Date.now(),
    });
  };

  const CONSTANTS = {
    BUTTON_MIN_WIDTH: 50,
    BUTTON_MIN_HEIGHT: 25,
    BUTTON_MIN_PADDING_VERTICAL: 3,
    BUTTON_MIN_PADDING_HORIZONTAL: 6,
    MAX_PARENT_TRAVERSAL: 5,
    MAX_BACKGROUND_SAMPLES: 100,
    MIN_SIGNIFICANT_AREA: 1000,
    MIN_LARGE_CONTAINER_AREA: 10000,
    DUPLICATE_POSITION_THRESHOLD: 1,
    MIN_LOGO_SIZE: 25,
    MIN_ALPHA_THRESHOLD: 0.1,
    MAX_TRANSPARENT_ALPHA: 0.01,
    BUTTON_SELECTOR: 'button,input[type="submit"],input[type="button"],[role=button],[data-primary-button],[data-secondary-button],[data-cta],a.button,a.btn,[class*="btn"],[class*="button"],a[class*="bg-brand"],a[class*="bg-primary"],a[class*="bg-accent"]',
  };

  const styleCache = new WeakMap();
  const getComputedStyleCached = (el) => {
    if (styleCache.has(el)) {
      return styleCache.get(el);
    }
    const style = getComputedStyle(el);
    styleCache.set(el, style);
    return style;
  };

  const toPx = v => {
    if (!v || v === "auto") return null;
    if (v.endsWith("px")) return parseFloat(v);
    if (v.endsWith("rem"))
      return (
        parseFloat(v) *
        parseFloat(getComputedStyle(document.documentElement).fontSize || 16)
      );
    if (v.endsWith("em"))
      return (
        parseFloat(v) *
        parseFloat(getComputedStyle(document.body).fontSize || 16)
      );
    if (v.endsWith("%")) return null;
    const num = parseFloat(v);
    return Number.isFinite(num) ? num : null;
  };

  const getClassNameString = (el) => {
    if (!el || !el.className) return '';
    try {
      if (el.className.baseVal !== undefined) {
        return String(el.className.baseVal || '');
      }
      if (typeof el.className.toString === 'function') {
        return String(el.className);
      }
      if (typeof el.className === 'string') {
        return el.className;
      }
      return String(el.className || '');
    } catch (e) {
      return '';
    }
  };

  const resolveSvgUseElements = (svgClone, originalSvg) => {
    // Find all <use> elements in the cloned SVG
    const useElements = Array.from(svgClone.querySelectorAll("use"));
    
    for (const useEl of useElements) {
      const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href");
      if (!href) continue;
      
      // Extract ID from href (format: #id or url(#id))
      const idMatch = href.match(/#([^)]+)/);
      if (!idMatch) continue;
      
      const targetId = idMatch[1];
      
      // Try to find the referenced element in the original SVG context
      // First check in the original SVG's defs or symbol
      let referencedEl = originalSvg.querySelector("#" + targetId);
      
      // If not found, check in parent SVG or document
      if (!referencedEl) {
        // Check in parent SVG if this SVG is nested
        let parent = originalSvg.parentElement;
        while (parent && !referencedEl) {
          if (parent.tagName === "svg" || parent.tagName === "SVG") {
            referencedEl = parent.querySelector("#" + targetId);
          }
          parent = parent.parentElement;
        }
      }
      
      // If still not found, check document root (for symbols defined globally)
      if (!referencedEl) {
        referencedEl = document.getElementById(targetId);
      }
      
      if (referencedEl && useEl.parentNode) {
        // Clone the referenced element
        const clonedRef = referencedEl.cloneNode(true);
        
        // If it's a <symbol>, we need to unwrap it and use its children
        if (clonedRef.tagName === "symbol" || clonedRef.tagName === "SYMBOL") {
          // Create a group to hold the symbol's children
          const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
          
          // Copy attributes from the use element to the group
          Array.from(useEl.attributes).forEach(attr => {
            if (attr.name !== "href" && attr.name !== "xlink:href") {
              group.setAttribute(attr.name, attr.value);
            }
          });
          
          // Move all children from symbol to group
          while (clonedRef.firstChild) {
            group.appendChild(clonedRef.firstChild);
          }
          
          // Replace use element with the group
          useEl.parentNode.replaceChild(group, useEl);
        } else {
          // For other elements (like <g>), clone and replace
          const clonedContent = clonedRef.cloneNode(true);
          
          // Copy attributes from use element
          Array.from(useEl.attributes).forEach(attr => {
            if (attr.name !== "href" && attr.name !== "xlink:href") {
              if (clonedContent.setAttribute) {
                clonedContent.setAttribute(attr.name, attr.value);
              }
            }
          });
          
          // Replace use element with cloned content
          useEl.parentNode.replaceChild(clonedContent, useEl);
        }
      }
    }
    
    return svgClone;
  };

  const resolveSvgStyles = svg => {
    // Clone the SVG first
    const svgClone = svg.cloneNode(true);
    
    // Resolve <use> elements in the clone (using original SVG for reference lookup)
    const svgWithResolvedUse = resolveSvgUseElements(svgClone, svg);
    
    // For style resolution, we'll work with the original SVG structure
    // to get computed styles, then try to apply them to the resolved clone
    // Note: After resolving use elements, structure may differ, so we do our best
    const originalElements = [svg, ...svg.querySelectorAll("*")];
    const computedStyles = originalElements.map(el => ({
      el,
      computed: getComputedStyle(el),
    }));

    // Get all elements from resolved SVG for style application
    const clonedElements = [svgWithResolvedUse, ...svgWithResolvedUse.querySelectorAll("*")];

    const svgDefaults = {
      fill: "rgb(0, 0, 0)",
      stroke: "none",
      "stroke-width": "1px",
      opacity: "1",
      "fill-opacity": "1",
      "stroke-opacity": "1",
    };

    const applyResolvedStyle = (clonedEl, originalEl, computed, prop) => {
      const attrValue = originalEl.getAttribute(prop);
      const value = computed.getPropertyValue(prop);

      if (attrValue && attrValue.includes("var(")) {
        clonedEl.removeAttribute(prop);
        if (value && value.trim() && value !== "none") {
          clonedEl.style.setProperty(prop, value, "important");
        }
      } else if (value && value.trim()) {
        const isExplicit =
          originalEl.hasAttribute(prop) || originalEl.style[prop];
        const isDifferent =
          svgDefaults[prop] !== undefined && value !== svgDefaults[prop];
        if (isExplicit || isDifferent) {
          clonedEl.style.setProperty(prop, value, "important");
        }
      }
    };

    // Map cloned elements to original elements by position
    // Note: after resolving use elements, the structure might have changed,
    // so we need to be careful with the mapping
    for (let i = 0; i < Math.min(clonedElements.length, originalElements.length); i++) {
      const clonedEl = clonedElements[i];
      const originalEl = originalElements[i];
      const computed = computedStyles[i]?.computed;
      if (!computed || !clonedEl) continue;

      const allProps = [
        "fill",
        "stroke",
        "color",
        "stop-color",
        "flood-color",
        "lighting-color",
        "stroke-width",
        "stroke-dasharray",
        "stroke-dashoffset",
        "stroke-linecap",
        "stroke-linejoin",
        "opacity",
        "fill-opacity",
        "stroke-opacity",
      ];

      for (const prop of allProps) {
        applyResolvedStyle(clonedEl, originalEl, computed, prop);
      }
    }

    return svgWithResolvedUse;
  };

  const collectCSSData = () => {
    const data = {
      colors: [],
      spacings: [],
      radii: [],
    };

    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        recordError('collectCSSData - CORS stylesheet', e);
        continue;
      }
      if (!rules) continue;

      for (const rule of Array.from(rules)) {
        try {
          if (rule.type === CSSRule.STYLE_RULE) {
            const s = rule.style;

            [
              "color",
              "background-color",
              "border-color",
              "fill",
              "stroke",
            ].forEach(prop => {
              const val = s.getPropertyValue(prop);
              if (val) data.colors.push(val);
            });

            [
              "border-radius",
              "border-top-left-radius",
              "border-top-right-radius",
              "border-bottom-left-radius",
              "border-bottom-right-radius",
            ].forEach(p => {
              const v = toPx(s.getPropertyValue(p));
              if (v) data.radii.push(v);
            });

            [
              "margin",
              "margin-top",
              "margin-right",
              "margin-bottom",
              "margin-left",
              "padding",
              "padding-top",
              "padding-right",
              "padding-bottom",
              "padding-left",
              "gap",
              "row-gap",
              "column-gap",
            ].forEach(p => {
              const v = toPx(s.getPropertyValue(p));
              if (v) data.spacings.push(v);
            });
          }
        } catch {}
      }
    }

    return data;
  };

  const checkButtonLikeElement = (el, cs, rect, classNames) => {
    const hasButtonClasses = 
      /rounded(-md|-lg|-xl|-full)?/.test(classNames) ||
      /px-\d+/.test(classNames) ||
      /py-\d+/.test(classNames) ||
      /p-\d+/.test(classNames) ||
      (/border/.test(classNames) && /rounded/.test(classNames)) ||
      (/inline-flex/.test(classNames) && /items-center/.test(classNames) && /justify-center/.test(classNames));
    
    if (hasButtonClasses && rect.width > CONSTANTS.BUTTON_MIN_WIDTH && rect.height > CONSTANTS.BUTTON_MIN_HEIGHT) {
      return true;
    }
    
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const paddingBottom = parseFloat(cs.paddingBottom) || 0;
    const paddingLeft = parseFloat(cs.paddingLeft) || 0;
    const paddingRight = parseFloat(cs.paddingRight) || 0;
    const hasPadding = paddingTop > CONSTANTS.BUTTON_MIN_PADDING_VERTICAL || 
                      paddingBottom > CONSTANTS.BUTTON_MIN_PADDING_VERTICAL || 
                      paddingLeft > CONSTANTS.BUTTON_MIN_PADDING_HORIZONTAL || 
                      paddingRight > CONSTANTS.BUTTON_MIN_PADDING_HORIZONTAL;
    const hasMinSize = rect.width > CONSTANTS.BUTTON_MIN_WIDTH && rect.height > CONSTANTS.BUTTON_MIN_HEIGHT;
    const hasRounded = parseFloat(cs.borderRadius) > 0;
    const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 ||
                     parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderRightWidth) > 0;
    
    return hasPadding && hasMinSize && (hasRounded || hasBorder);
  };

  const isButtonElement = (el) => {
    if (!el || typeof el.matches !== 'function') return false;
    
    if (el.matches(CONSTANTS.BUTTON_SELECTOR)) {
      return true;
    }
    
    if (el.tagName.toLowerCase() === 'a') {
      try {
        const classNames = getClassNameString(el).toLowerCase();
        const cs = getComputedStyleCached(el);
        const rect = el.getBoundingClientRect();
        return checkButtonLikeElement(el, cs, rect, classNames);
      } catch (e) {
        recordError('isButtonElement', e);
        return false;
      }
    }
    
    return false;
  };

  const looksLikeButton = (el) => {
    return isButtonElement(el);
  };

  const sampleElements = () => {
    const picksSet = new Set();
    
    const pushQ = (q, limit = 10) => {
      const elements = document.querySelectorAll(q);
      let count = 0;
      for (const el of elements) {
        if (count >= limit) break;
        picksSet.add(el);
        count++;
      }
    };

    pushQ('header img, .site-logo img, img[alt*=logo i], img[src*="logo"]', 5);
    
    pushQ(
      'button, input[type="submit"], input[type="button"], [role=button], [data-primary-button], [data-secondary-button], [data-cta], a.button, a.btn, [class*="btn"], [class*="button"], a[class*="bg-brand"], a[class*="bg-primary"], a[class*="bg-accent"]',
      100,
    );
    
    const allLinks = Array.from(document.querySelectorAll('a')).slice(0, 100);
    for (const link of allLinks) {
      if (!picksSet.has(link) && looksLikeButton(link)) {
        picksSet.add(link);
      }
    }
    
    pushQ('input, select, textarea, [class*="form-control"]', 25);
    pushQ("h1, h2, h3, p, a", 50);

    const result = [...picksSet];
    
    return result.filter(Boolean);
  };

  const getStyleSnapshot = el => {
    const cs = getComputedStyleCached(el);
    const rect = el.getBoundingClientRect();

    const fontStack =
      cs
        .getPropertyValue("font-family")
        ?.split(",")
        .map(f => f.replace(/["']/g, "").trim())
        .filter(Boolean) || [];

    let classNames = "";
    try {
      if (el.getAttribute) {
        const attrClass = el.getAttribute("class");
        if (attrClass) classNames = attrClass.toLowerCase();
      }
      if (!classNames) {
        classNames = getClassNameString(el).toLowerCase();
      }
    } catch (e) {
      try {
        classNames = getClassNameString(el).toLowerCase();
      } catch (e2) {
        classNames = "";
      }
    }

    let bgColor = cs.getPropertyValue("background-color");
    const textColor = cs.getPropertyValue("color");
    
    const isTransparent = bgColor === "transparent" || bgColor === "rgba(0, 0, 0, 0)";
    const alphaMatch = bgColor.match(/rgba?\([^,]*,[^,]*,[^,]*,\s*([\d.]+)\)/);
    const hasZeroAlpha = alphaMatch && parseFloat(alphaMatch[1]) === 0;
    
    const isInputElement = el.tagName.toLowerCase() === 'input' || 
                          el.tagName.toLowerCase() === 'select' || 
                          el.tagName.toLowerCase() === 'textarea';
    
    if ((isTransparent || hasZeroAlpha) && !isInputElement) {
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < CONSTANTS.MAX_PARENT_TRAVERSAL) {
        const parentBg = getComputedStyleCached(parent).getPropertyValue("background-color");
        if (parentBg && parentBg !== "transparent" && parentBg !== "rgba(0, 0, 0, 0)") {
          const parentAlphaMatch = parentBg.match(/rgba?\([^,]*,[^,]*,[^,]*,\s*([\d.]+)\)/);
          const parentAlpha = parentAlphaMatch ? parseFloat(parentAlphaMatch[1]) : 1;
          if (parentAlpha > CONSTANTS.MIN_ALPHA_THRESHOLD) {
            bgColor = parentBg;
            break;
          }
        }
        parent = parent.parentElement;
        depth++;
      }
    }

    const isButton = isButtonElement(el);

    let isNavigation = false;
    let hasCTAIndicator = false;

    try {
      hasCTAIndicator =
        el.matches(
          '[data-primary-button],[data-secondary-button],[data-cta],[class*="cta"],[class*="hero"]',
        ) ||
        el.getAttribute("data-primary-button") === "true" ||
        el.getAttribute("data-secondary-button") === "true";

      if (!hasCTAIndicator) {
        const hasNavClass = classNames.includes("nav-") ||
          classNames.includes("-nav") ||
          classNames.includes("nav-anchor") ||
          classNames.includes("nav-link") ||
          classNames.includes("sidebar-") ||
          classNames.includes("-sidebar") ||
          classNames.includes("menu-") ||
          classNames.includes("-menu") ||
          classNames.includes("toggle") ||
          classNames.includes("trigger");
        
        const hasNavRole = el.matches(
          '[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[aria-haspopup],[aria-expanded]',
        );
        
        const inNavContext = !!el.closest(
          'nav, [role="navigation"], [role="menu"], [role="menubar"], [class*="navigation"], [class*="dropdown"], [class*="sidebar"], [id*="sidebar"], [id*="navigation"], [id*="nav-"], aside[class*="nav"], aside[id*="nav"]',
        );
        
        let isNavLink = false;
        if (el.tagName.toLowerCase() === "a" && el.parentElement) {
          if (el.parentElement.tagName.toLowerCase() === "li") {
            const listEl = el.closest("ul, ol");
            if (listEl && listEl.closest('[class*="nav"], [id*="nav"], [class*="sidebar"], [id*="sidebar"]')) {
              isNavLink = true;
            }
          }
        }
        
        isNavigation = hasNavClass || hasNavRole || inNavContext || isNavLink;
      }
    } catch (e) {}

    let text = "";
    if (el.tagName.toLowerCase() === 'input' && (el.type === 'submit' || el.type === 'button')) {
      text = (el.value && el.value.trim().substring(0, 100)) || "";
    } else {
      text = (el.textContent && el.textContent.trim().substring(0, 100)) || "";
    }

    const isInputField = el.matches('input:not([type="submit"]):not([type="button"]),select,textarea,[class*="form-control"]');
    let inputMetadata = null;
    if (isInputField) {
      const tagName = el.tagName.toLowerCase();
      inputMetadata = {
        type: tagName === 'input' ? (el.type || 'text') : tagName,
        placeholder: el.placeholder || "",
        value: tagName === 'input' ? (el.value || "") : "",
        required: el.required || false,
        disabled: el.disabled || false,
        name: el.name || "",
        id: el.id || "",
        label: (() => {
          if (el.id) {
            const label = document.querySelector('label[for="' + el.id + '"]');
            if (label) return (label.textContent || "").trim().substring(0, 100);
          }
          const parentLabel = el.closest('label');
          if (parentLabel) {
            const clone = parentLabel.cloneNode(true);
            const inputInClone = clone.querySelector('input,select,textarea');
            if (inputInClone) inputInClone.remove();
            return (clone.textContent || "").trim().substring(0, 100);
          }
          return "";
        })(),
      };
    }

    return {
      tag: el.tagName.toLowerCase(),
      classes: classNames,
      text: text,
      rect: { w: rect.width, h: rect.height },
      colors: {
        text: textColor,
        background: bgColor,
        border: (() => {
          const top = cs.getPropertyValue("border-top-color");
          const right = cs.getPropertyValue("border-right-color");
          const bottom = cs.getPropertyValue("border-bottom-color");
          const left = cs.getPropertyValue("border-left-color");
          if (top === right && top === bottom && top === left) return top;
          return top;
        })(),
        borderWidth: (() => {
          const top = toPx(cs.getPropertyValue("border-top-width"));
          const right = toPx(cs.getPropertyValue("border-right-width"));
          const bottom = toPx(cs.getPropertyValue("border-bottom-width"));
          const left = toPx(cs.getPropertyValue("border-left-width"));
          if (top === right && top === bottom && top === left) return top;
          return top;
        })(),
        borderTop: cs.getPropertyValue("border-top-color"),
        borderTopWidth: toPx(cs.getPropertyValue("border-top-width")),
        borderRight: cs.getPropertyValue("border-right-color"),
        borderRightWidth: toPx(cs.getPropertyValue("border-right-width")),
        borderBottom: cs.getPropertyValue("border-bottom-color"),
        borderBottomWidth: toPx(cs.getPropertyValue("border-bottom-width")),
        borderLeft: cs.getPropertyValue("border-left-color"),
        borderLeftWidth: toPx(cs.getPropertyValue("border-left-width")),
      },
      typography: {
        fontStack,
        size: cs.getPropertyValue("font-size") || null,
        weight: parseInt(cs.getPropertyValue("font-weight"), 10) || null,
      },
      radius: toPx(cs.getPropertyValue("border-radius")),
      borderRadius: {
        topLeft: toPx(cs.getPropertyValue("border-top-left-radius")),
        topRight: toPx(cs.getPropertyValue("border-top-right-radius")),
        bottomRight: toPx(cs.getPropertyValue("border-bottom-right-radius")),
        bottomLeft: toPx(cs.getPropertyValue("border-bottom-left-radius")),
      },
      shadow: cs.getPropertyValue("box-shadow") || null,
      isButton: isButton && !isNavigation,
      isNavigation: isNavigation,
      hasCTAIndicator: hasCTAIndicator,
      isInput: isInputField,
      inputMetadata: inputMetadata,
      isLink: el.matches("a"),
    };
  };



  const findImages = () => {
    const imgs = [];
    const logoCandidates = [];
    const debugLogo =
      typeof window !== "undefined" &&
      !!window.__FIRECRAWL_DEBUG_BRANDING_LOGO;
    const debugStats = debugLogo
      ? {
          attempted: 0,
          added: 0,
          skipped: {},
          skipSamples: [],
          candidateSamples: [],
          selectorCounts: {},
        }
      : null;
    const truncate = (value, max = 120) => {
      if (!value) return "";
      const str = String(value);
      return str.length > max ? str.slice(0, max) + "..." : str;
    };
    const getDebugMeta = (el, rect) => {
      if (!el) return {};
      let href = "";
      try {
        const anchor = el.closest ? el.closest("a") : null;
        href = anchor ? anchor.getAttribute("href") || "" : "";
      } catch {}
      return {
        tag: el.tagName ? el.tagName.toLowerCase() : "",
        id: el.id || "",
        className: getClassNameString(el),
        src: truncate(el.src || el.getAttribute?.("href") || ""),
        alt: el.alt || "",
        ariaLabel: el.getAttribute?.("aria-label") || "",
        href: truncate(href),
        rect: rect
          ? {
              w: Math.round(rect.width || 0),
              h: Math.round(rect.height || 0),
              top: Math.round(rect.top || 0),
              left: Math.round(rect.left || 0),
            }
          : undefined,
      };
    };
    const recordSkip = (reason, el, rect, details) => {
      if (!debugStats) return;
      debugStats.skipped[reason] = (debugStats.skipped[reason] || 0) + 1;
      if (debugStats.skipSamples.length < 10) {
        debugStats.skipSamples.push({
          reason,
          details,
          ...getDebugMeta(el, rect),
        });
      }
    };
    const recordAdd = (candidate) => {
      if (!debugStats) return;
      debugStats.added += 1;
      if (debugStats.candidateSamples.length < 5) {
        debugStats.candidateSamples.push({
          src: truncate(candidate.src),
          alt: candidate.alt || "",
          location: candidate.location,
          isSvg: candidate.isSvg,
          indicators: candidate.indicators,
          width: Math.round(candidate.position?.width || 0),
          height: Math.round(candidate.position?.height || 0),
        });
      }
    };
    const push = (src, type) => {
      if (src) imgs.push({ type, src });
    };

    push(document.querySelector('link[rel*="icon" i]')?.href, "favicon");
    push(document.querySelector('meta[property="og:image" i]')?.content, "og");
    push(
      document.querySelector('meta[name="twitter:image" i]')?.content,
      "twitter",
    );

    const extractBackgroundImageUrl = (bgImage) => {
      if (!bgImage || bgImage === 'none') return null;
      
      // Try to match url("...") or url('...') first - handle quoted URLs
      // This handles both data URIs and regular URLs with quotes
      const quotedMatch = bgImage.match(/url\((["'])(.*?)\1\)/);
      if (quotedMatch) {
        let url = quotedMatch[2];
        // Handle HTML entities that might still be encoded
        if (url.includes('&quot;') || url.includes('&lt;') || url.includes('&gt;')) {
          url = url.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        }
        
        // For data URIs with SVG content, ensure proper URL encoding
        // Check if it's already URL-encoded (has charset=utf-8 or starts with %)
        if (url.startsWith('data:image/svg+xml')) {
          // Check if already encoded (has charset=utf-8 or starts with %)
          const isAlreadyEncoded = url.includes('charset=utf-8') || 
                                   (url.includes('data:image/svg+xml,') && url.split('data:image/svg+xml,')[1]?.startsWith('%'));
          
          if (!isAlreadyEncoded) {
            // Extract the SVG content (handle both with and without charset)
            let svgContent = '';
            if (url.includes('charset=utf-8,')) {
              svgContent = url.split('charset=utf-8,')[1];
            } else if (url.includes('data:image/svg+xml,')) {
              svgContent = url.split('data:image/svg+xml,')[1];
            }
            
            if (svgContent) {
              // Remove any escaped quotes that might cause XML parsing errors
              let cleanSvg = svgContent.replace(/\\"/g, '"').replace(/\\'/g, "'");
              // URL-encode the SVG content to ensure it's valid
              try {
                const encodedSvg = encodeURIComponent(cleanSvg);
                url = 'data:image/svg+xml;charset=utf-8,' + encodedSvg;
              } catch (e) {
                // If encoding fails, try to at least fix common issues
                url = 'data:image/svg+xml;charset=utf-8,' + cleanSvg.replace(/"/g, '%22').replace(/'/g, '%27');
              }
            }
          }
          // If already encoded, use as-is (it's already valid)
        }
        
        if (debugLogo && (url.includes('cal.com') || url.includes('Cal.com') || url.startsWith('data:'))) {
          console.log('🔥 [LOGO DEBUG] Extracted quoted URL:', {
            original: bgImage.substring(0, 200) + '...',
            extracted: url.substring(0, 100) + '...',
            isDataUri: url.startsWith('data:'),
          });
        }
        
        return url;
      }
      
      // Try to match url(...) without quotes
      // For data URIs, match until the closing paren (they can be very long)
      const unquotedMatch = bgImage.match(/url\((data:[^)]+)\)/);
      if (unquotedMatch) {
        let url = unquotedMatch[1];
        // Handle HTML entities
        if (url.includes('&quot;') || url.includes('&lt;') || url.includes('&gt;')) {
          url = url.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        }
        
        // For data URIs with SVG content, ensure proper URL encoding
        // Check if it's already URL-encoded (has charset=utf-8 or starts with %)
        if (url.startsWith('data:image/svg+xml')) {
          // Check if already encoded (has charset=utf-8 or starts with %)
          const isAlreadyEncoded = url.includes('charset=utf-8') || 
                                   url.includes('data:image/svg+xml,') && url.split('data:image/svg+xml,')[1]?.startsWith('%');
          
          if (!isAlreadyEncoded) {
            // Extract the SVG content (handle both with and without charset)
            let svgContent = '';
            if (url.includes('charset=utf-8,')) {
              svgContent = url.split('charset=utf-8,')[1];
            } else if (url.includes('data:image/svg+xml,')) {
              svgContent = url.split('data:image/svg+xml,')[1];
            }
            
            if (svgContent) {
              // Remove any escaped quotes that might cause XML parsing errors
              let cleanSvg = svgContent.replace(/\\"/g, '"').replace(/\\'/g, "'");
              // URL-encode the SVG content to ensure it's valid
              try {
                const encodedSvg = encodeURIComponent(cleanSvg);
                url = 'data:image/svg+xml;charset=utf-8,' + encodedSvg;
              } catch (e) {
                // If encoding fails, try to at least fix common issues
                url = 'data:image/svg+xml;charset=utf-8,' + cleanSvg.replace(/"/g, '%22').replace(/'/g, '%27');
              }
            }
          }
          // If already encoded, use as-is (it's already valid)
        }
        
        if (debugLogo && (url.includes('cal.com') || url.includes('Cal.com'))) {
          console.log('🔥 [LOGO DEBUG] Extracted unquoted data URI:', {
            original: bgImage.substring(0, 200) + '...',
            extracted: url.substring(0, 100) + '...',
          });
        }
        
        return url;
      }
      
      // Fallback: try simple pattern for regular URLs
      const simpleMatch = bgImage.match(/url\(([^)]+)\)/);
      if (simpleMatch) {
        let url = simpleMatch[1].trim().replace(/^["']|["']$/g, ''); // Remove surrounding quotes if any
        
        // For data URIs with SVG content, ensure proper URL encoding
        // Check if it's already URL-encoded (has charset=utf-8 or starts with %)
        if (url.startsWith('data:image/svg+xml')) {
          // Check if already encoded (has charset=utf-8 or starts with %)
          const isAlreadyEncoded = url.includes('charset=utf-8') || 
                                   url.includes('data:image/svg+xml,') && url.split('data:image/svg+xml,')[1]?.startsWith('%');
          
          if (!isAlreadyEncoded) {
            // Extract the SVG content (handle both with and without charset)
            let svgContent = '';
            if (url.includes('charset=utf-8,')) {
              svgContent = url.split('charset=utf-8,')[1];
            } else if (url.includes('data:image/svg+xml,')) {
              svgContent = url.split('data:image/svg+xml,')[1];
            }
            
            if (svgContent) {
              let cleanSvg = svgContent.replace(/\\"/g, '"').replace(/\\'/g, "'");
              try {
                const encodedSvg = encodeURIComponent(cleanSvg);
                url = 'data:image/svg+xml;charset=utf-8,' + encodedSvg;
              } catch (e) {
                url = 'data:image/svg+xml;charset=utf-8,' + cleanSvg.replace(/"/g, '%22').replace(/'/g, '%27');
              }
            }
          }
          // If already encoded, use as-is (it's already valid)
        }
        
        return url;
      }
      
      return null;
    };

    // Helper function to check if an href is a home link (including full URLs)
    const isHomeHref = (href) => {
      if (!href) return false;
      
      const normalizedHref = href.trim();
      
      // Check for relative home paths
      if (normalizedHref === './' || 
          normalizedHref === '/' || 
          normalizedHref === '/home' || 
          normalizedHref === '/index' ||
          normalizedHref === '') {
        return true;
      }
      
      // Check for full URLs that point to homepage
      if (normalizedHref.startsWith('http://') || 
          normalizedHref.startsWith('https://') || 
          normalizedHref.startsWith('//')) {
        try {
          const currentHostname = window.location.hostname.toLowerCase();
          const linkUrl = new URL(href, window.location.origin);
          const linkHostname = linkUrl.hostname.toLowerCase();
          
          // Same domain and path is root or home/index
          if (linkHostname === currentHostname && 
              (linkUrl.pathname === '/' || 
               linkUrl.pathname === '/home' || 
               linkUrl.pathname === '/index' ||
               linkUrl.pathname === '/index.html')) {
            return true;
          }
        } catch (e) {
          // URL parsing failed, not a home link
        }
      }
      
      return false;
    };

    // Extract sprite portion from a sprite sheet
    // Returns a data URI of the cropped sprite portion, or null if extraction fails
    const extractSpritePortion = (spriteUrl, el, style) => {
      try {
        // Check if background-position is set (indicates sprite sheet usage)
        const bgPosition = style.getPropertyValue('background-position');
        const bgSize = style.getPropertyValue('background-size');
        
        // If no background-position or it's "0 0", might not be a sprite (or using first sprite)
        // Still check if background-size suggests sprite usage
        const hasSpriteIndicators = bgPosition && bgPosition !== '0px 0px' && bgPosition !== '0% 0%' && bgPosition !== '0 0';
        const hasSpriteSize = bgSize && bgSize !== 'auto' && bgSize !== 'cover' && bgSize !== 'contain';
        
        if (!hasSpriteIndicators && !hasSpriteSize) {
          return null; // Not a sprite sheet
        }

        const rect = el.getBoundingClientRect();
        const elementWidth = rect.width;
        const elementHeight = rect.height;
        
        if (elementWidth <= 0 || elementHeight <= 0) {
          return null;
        }

        // Parse background-position (can be "x y", "x% y%", "xpx ypx", etc.)
        const parsePosition = (pos) => {
          if (!pos || pos === '0' || pos === '0px' || pos === '0%') return 0;
          const parts = pos.trim().split(/\s+/);
          if (parts.length < 2) return 0;
          
          // Parse X position
          let x = 0;
          if (parts[0].endsWith('px')) {
            x = parseFloat(parts[0]);
          } else if (parts[0].endsWith('%')) {
            // For percentage, we'd need sprite dimensions - skip for now, use pixel values
            return null;
          } else {
            x = parseFloat(parts[0]) || 0;
          }
          
          // Parse Y position
          let y = 0;
          if (parts[1].endsWith('px')) {
            y = parseFloat(parts[1]);
          } else if (parts[1].endsWith('%')) {
            return null; // Skip percentage for now
          } else {
            y = parseFloat(parts[1]) || 0;
          }
          
          return { x: -x, y: -y }; // Negative because background-position is the offset
        };

        const position = parsePosition(bgPosition);
        if (!position) {
          return null; // Couldn't parse position
        }

        // Try to load and extract the sprite
        // Note: This requires the image to be already loaded (in cache)
        // We'll try to create an image element and see if it's accessible
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Try to handle CORS
        
        // For now, we'll attempt synchronous extraction if possible
        // If the image is in cache, we might be able to access it
        // Otherwise, we'll return null and use the full sprite URL
        
        // Create a canvas to extract the sprite portion
        const canvas = document.createElement('canvas');
        canvas.width = elementWidth;
        canvas.height = elementHeight;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          return null;
        }

        // Try to draw the sprite portion
        // This is a synchronous attempt - if image isn't loaded, it won't work
        // We'll need to handle this asynchronously or mark for post-processing
        // For now, return null to indicate sprite needs special handling
        // The backend could handle sprite extraction, or we could add async support
        
        // Actually, let's try a different approach: return metadata about the sprite
        // that can be used for extraction later, or attempt async loading
        // But since we need to return synchronously, let's mark it and return the full URL
        
        return null; // Indicates sprite extraction needed but can't be done synchronously
      } catch (e) {
        recordError("extractSpritePortion", e);
        return null;
      }
    };

    // Async helper to extract sprite portion (for use when async is possible)
    const extractSpritePortionAsync = async (spriteUrl, el, style) => {
      try {
        const bgPosition = style.getPropertyValue('background-position');
        const bgSize = style.getPropertyValue('background-size');
        
        const hasSpriteIndicators = bgPosition && bgPosition !== '0px 0px' && bgPosition !== '0% 0%' && bgPosition !== '0 0';
        const hasSpriteSize = bgSize && bgSize !== 'auto' && bgSize !== 'cover' && bgSize !== 'contain';
        
        if (!hasSpriteIndicators && !hasSpriteSize) {
          return null;
        }

        const rect = el.getBoundingClientRect();
        const elementWidth = Math.max(rect.width, 1);
        const elementHeight = Math.max(rect.height, 1);
        
        // Parse background-position
        const parsePosition = (pos) => {
          if (!pos || pos === '0' || pos === '0px' || pos === '0%') return { x: 0, y: 0 };
          const parts = pos.trim().split(/\s+/);
          if (parts.length < 2) return { x: 0, y: 0 };
          
          let x = 0;
          if (parts[0].endsWith('px')) {
            x = parseFloat(parts[0]) || 0;
          } else if (parts[0].endsWith('%')) {
            // For percentage, we'd need sprite dimensions
            return null;
          } else {
            x = parseFloat(parts[0]) || 0;
          }
          
          let y = 0;
          if (parts[1].endsWith('px')) {
            y = parseFloat(parts[1]) || 0;
          } else if (parts[1].endsWith('%')) {
            return null;
          } else {
            y = parseFloat(parts[1]) || 0;
          }
          
          return { x: -x, y: -y };
        };

        const position = parsePosition(bgPosition);
        if (!position) {
          return null;
        }

        // Load the sprite image
        const img = await new Promise((resolve, reject) => {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('Failed to load sprite image'));
          image.src = spriteUrl;
        });

        // Create canvas and extract the sprite portion
        const canvas = document.createElement('canvas');
        canvas.width = elementWidth;
        canvas.height = elementHeight;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          return null;
        }

        // Draw the sprite portion
        ctx.drawImage(
          img,
          -position.x, -position.y, // Source position in sprite
          elementWidth, elementHeight, // Source size
          0, 0, // Destination position
          elementWidth, elementHeight // Destination size
        );

        // Convert to data URI
        return canvas.toDataURL('image/png');
      } catch (e) {
        recordError("extractSpritePortionAsync", e);
        return null;
      }
    };

    const collectLogoCandidate = (el, source) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyleCached(el);
      if (debugStats) {
        debugStats.attempted += 1;
      }
      
      // Debug logging for specific cases
      const dataName = el.getAttribute('data-framer-name') || el.getAttribute('data-name') || '';
      const parentLink = el.closest('a');
      const parentAria = parentLink?.getAttribute('aria-label') || '';
      const parentHref = parentLink?.getAttribute('href') || '';
      const isCalComCase = dataName.toLowerCase().includes('cal.com logo') || 
                          (parentAria.toLowerCase().includes('cal.com') && parentHref === './');
      
      if (debugLogo && isCalComCase) {
        console.log('🔥 [LOGO DEBUG] collectLogoCandidate called:', {
          source,
          tag: el.tagName,
          dataName,
          parentAria,
          parentHref,
          rect: { w: rect.width, h: rect.height, top: rect.top, left: rect.left },
        });
      }
      
      const isVisible = (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
      
      if (debugLogo && isCalComCase) {
        console.log('🔥 [LOGO DEBUG] Visibility check:', { isVisible, width: rect.width, height: rect.height });
      }

      // Check for CSS background-image logos (common pattern)
      const bgImage = style.getPropertyValue('background-image');
      const bgImageUrl = extractBackgroundImageUrl(bgImage);
      
      // Check for logo indicators in various places (reuse parentLink from debug section above)
      const parentAriaLabel = parentLink?.getAttribute('aria-label') || '';
      const hasLogoAriaLabel = /logo|home|brand/i.test(parentAriaLabel);
      const hasLogoDataAttr = el.getAttribute('data-framer-name')?.toLowerCase().includes('logo') ||
                              el.getAttribute('data-name')?.toLowerCase().includes('logo');
      const inHeaderNav = el.closest('header, nav, [role="banner"]') !== null;
      const hasHomeHref = parentLink && isHomeHref(parentLink.getAttribute('href') || '');
      
      if (debugLogo && isCalComCase) {
        console.log('🔥 [LOGO DEBUG] Background image check:', {
          hasBgImage: !!bgImage && bgImage !== 'none',
          bgImagePreview: bgImage ? bgImage.substring(0, 200) + '...' : null,
          bgImageUrl: bgImageUrl ? bgImageUrl.substring(0, 100) + '...' : null,
          hasLogoDataAttr,
          hasLogoAriaLabel,
          hasHomeHref,
          inHeaderNav,
          parentAriaLabel,
          parentHref: parentLink?.getAttribute('href'),
        });
      }
      
      const hasBackgroundLogo = bgImageUrl && (
        /logo/i.test(bgImageUrl) ||
        el.closest('[class*="logo" i], [id*="logo" i]') !== null ||
        (el.tagName.toLowerCase() === 'a' && inHeaderNav) ||
        (parentLink && inHeaderNav && hasHomeHref) ||
        hasLogoAriaLabel ||
        hasLogoDataAttr ||
        (parentLink && inHeaderNav && /home/i.test(parentAriaLabel))
      );

      const imgSrc = el.src || '';
      if (imgSrc) {
        const ogImageSrc = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
        const twitterImageSrc = document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') || '';
        
        if ((ogImageSrc && imgSrc.includes(ogImageSrc)) || 
            (twitterImageSrc && imgSrc.includes(twitterImageSrc)) ||
            (ogImageSrc && ogImageSrc.includes(imgSrc)) ||
            (twitterImageSrc && twitterImageSrc.includes(imgSrc))) {
          recordSkip("social-image-match", el, rect, { imgSrc });
          return;
        }
      }

      const inHeader = el.closest(
        'header, nav, [role="banner"], #navbar, [id*="navbar" i], [class*="navbar" i], [id*="header" i], [class*="header" i]',
      ) !== null;
      
      // Also check if parent link is in header (for divs inside links)
      const parentInHeader = parentLink && parentLink.closest(
        'header, nav, [role="banner"], #navbar, [id*="navbar" i], [class*="navbar" i], [id*="header" i], [class*="header" i]',
      ) !== null;
      
      // Check if element is in a top-level navigation container (sticky/fixed at top, or first visible element)
      // This catches cases where the header isn't a <header> element but acts like one
      let inTopLevelNav = false;
      if (!inHeader && !parentInHeader) {
        const topLevelContainer = el.closest('[class*="sticky" i], [class*="fixed" i], [style*="position: sticky" i], [style*="position:fixed" i]');
        if (topLevelContainer) {
          const containerRect = topLevelContainer.getBoundingClientRect();
          const containerStyle = getComputedStyleCached(topLevelContainer);
          const isAtTop = containerRect.top <= 50; // Within 50px of top
          const hasNavLikeContent = topLevelContainer.querySelector('nav, a[href="/"], a[href="./"]') !== null;
          const hasStickyOrFixed = /sticky|fixed/i.test(containerStyle.position) || 
                                   /top-0|top:0|top:\s*0/i.test(containerStyle.cssText);
          
          if (isAtTop && (hasNavLikeContent || hasStickyOrFixed)) {
            inTopLevelNav = true;
          }
        }
        
        // Also check if element itself is near the top of the page (first visible element)
        // and has a home link - this is a strong indicator it's a logo
        if (!inTopLevelNav && hasHomeHref && rect.top <= 100 && rect.left <= 200) {
          inTopLevelNav = true;
        }
      }
      
      const finalInHeader = inHeader || parentInHeader || inTopLevelNav;
      
      // Check if element is inside a language switcher - be more specific
      // Skip small flag images (usually language flags) or elements inside language lists
      const isSmallFlagImage = rect.width <= 20 && rect.height <= 20 && 
                               (el.src && /flag|lang|country/i.test(el.src.toLowerCase()));
      
      // Check if inside language switcher containers
      const langSwitcherParent = el.closest('ul[class*="lang"], li[class*="lang"], div[class*="lang"], nav[class*="lang"], [id*="lang"], [id*="language"]');
      
      if (isSmallFlagImage) {
        recordSkip("small-flag", el, rect);
        return;
      }
      
      if (langSwitcherParent) {
        const parentClasses = getClassNameString(langSwitcherParent).toLowerCase();
        const parentTagName = langSwitcherParent.tagName;
        
        // Only skip if it's clearly a language switcher (has language-related classes AND is in a list/container)
        const isLanguageList = parentTagName === 'UL' && /lang|language/i.test(parentClasses);
        const isLanguageItem = parentTagName === 'LI' && /lang|language/i.test(parentClasses);
        const isLanguageContainer = (parentTagName === 'DIV' || parentTagName === 'NAV') && 
                                    /header-lang|lang-switch|language-switch|lang-select|language-select|language-list/i.test(parentClasses);
        
        // Also check if parent has explicit language switcher indicators
        const hasExplicitLangIndicator = /lang-item|language-list|lang-switch|language-switch|lang-select|language-select/i.test(parentClasses);
        
        if (isLanguageList || isLanguageItem || isLanguageContainer || hasExplicitLangIndicator) {
          recordSkip("language-switcher", el, rect, {
            parentTagName: parentTagName,
            parentClasses: parentClasses,
          });
          return;
        }
      }
      
      const insideButton = el.closest('button, [role="button"], input[type="button"], input[type="submit"]');
      if (insideButton) {
        // Don't skip if this is clearly a logo in a nav/header context
        // Many logos are wrapped in clickable divs with role="button" for accessibility
        const isLogoInNavContext = (
          finalInHeader && // In header/nav
          (hasHomeHref || hasLogoAriaLabel || hasLogoDataAttr) // Has logo indicators
        );
        
        // Also allow if the button-like element itself has logo indicators
        const buttonHasLogoIndicators = insideButton && (
          /logo|brand/i.test(getClassNameString(insideButton)) ||
          /logo|brand/i.test(insideButton.getAttribute('data-framer-name') || '') ||
          /logo|brand/i.test(insideButton.getAttribute('data-name') || '') ||
          /logo|home|brand/i.test(insideButton.getAttribute('aria-label') || '')
        );
        
        // Also check if the element itself (img/svg) has logo indicators in alt or aria-label
        const elementHasLogoIndicators = (
          /logo|brand/i.test(el.getAttribute('alt') || '') ||
          /logo|brand/i.test(el.getAttribute('aria-label') || '')
        );
        
        if (!isLogoInNavContext && !buttonHasLogoIndicators && !elementHasLogoIndicators) {
          recordSkip("inside-button", el, rect);
          return;
        }
      }
      

      const elementClasses = getClassNameString(el).toLowerCase();
      const elementId = (el.id || '').toLowerCase();
      const ariaLabel = (el.getAttribute?.('aria-label') || '').toLowerCase();
      
      // Check if element itself has search indicators
      const hasSearchClass = /search|magnif/i.test(elementClasses);
      const hasSearchId = /search|magnif/i.test(elementId);
      const hasSearchAriaLabel = /search/i.test(ariaLabel);
      
      // Only check immediate parent context, not all ancestors
      // Skip if inside a search form, search button, or search input container
      const parent = el.parentElement;
      const isInSearchForm = parent && (
        parent.tagName === 'FORM' && /search/i.test(getClassNameString(parent) + (parent.id || '')) ||
        parent.matches && parent.matches('form[class*="search"], form[id*="search"], button[class*="search"], button[id*="search"], [role="search"]')
      );
      
      // Also check if it's inside a button/link that has search-related classes
      const inSearchButton = el.closest('button[class*="search"], button[id*="search"], a[class*="search"], a[id*="search"]');
      
      const isSearchIcon = hasSearchClass || hasSearchId || hasSearchAriaLabel || isInSearchForm || !!inSearchButton;
      
      if (isSearchIcon) {
        recordSkip("search-icon", el, rect);
        return;
      }
      
      const isUIIcon = 
        /icon|menu|hamburger|bars|close|times|cart|user|account|profile|settings|notification|bell|chevron|arrow|caret|dropdown/i.test(elementClasses) ||
        /icon|menu|hamburger|cart|user|bell/i.test(elementId) ||
        /menu|close|cart|user|settings/i.test(ariaLabel);
      
      if (isUIIcon) {
        const hasExplicitLogoIndicator = 
          /logo|brand|site-name|site-title/i.test(elementClasses) ||
          /logo|brand/i.test(elementId);
        
        if (!hasExplicitLogoIndicator) {
          recordSkip("ui-icon", el, rect);
          return;
        }
      }
      
      const anchorParent = el.closest('a');
      const href = anchorParent ? (anchorParent.getAttribute('href') || '') : '';
      const anchorAriaLabel = (anchorParent?.getAttribute('aria-label') || '').toLowerCase();
      const ariaLabelHomeMatch =
        /\bhome(page)?\b/.test(ariaLabel) ||
        /\bhome(page)?\b/.test(anchorAriaLabel);
      const candidateAriaLabel = ariaLabel || anchorAriaLabel || "";
      
      if (href && href.trim()) {
        const hrefLower = href.toLowerCase().trim();
        
        const isExternalLink = 
          hrefLower.startsWith('http://') || 
          hrefLower.startsWith('https://') || 
          hrefLower.startsWith('//');
        
        if (isExternalLink) {
          const externalServiceDomains = [
            'github.com', 'twitter.com', 'x.com', 'facebook.com', 'linkedin.com',
            'instagram.com', 'youtube.com', 'discord.com', 'slack.com',
            'npmjs.com', 'pypi.org', 'crates.io', 'packagist.org',
            'badge.fury.io', 'shields.io', 'img.shields.io', 'badgen.net',
            'codecov.io', 'coveralls.io', 'circleci.com', 'travis-ci.org',
            'app.netlify.com', 'vercel.com'
          ];
          
          if (externalServiceDomains.some(domain => hrefLower.includes(domain))) {
            recordSkip("external-service-domain", el, rect, { href });
            return;
          }
          
          try {
            const currentHostname = window.location.hostname.toLowerCase();
            const linkUrl = new URL(href, window.location.origin);
            const linkHostname = linkUrl.hostname.toLowerCase();
            
            if (linkHostname !== currentHostname) {
              recordSkip("external-link-different-host", el, rect, {
                href,
                currentHostname,
                linkHostname,
              });
              return;
            }
          } catch (e) {
            recordSkip("external-link-parse-error", el, rect, { href });
            return;
          }
        }
      }
      
      const isSvg = el.tagName.toLowerCase() === "svg";
      
      // Calculate logo score for SVGs (higher = more likely to be a graphic logo vs text)
      let logoSvgScore = 0;
      if (isSvg) {
        const rect = el.getBoundingClientRect();
        const svgWidth = rect.width || parseFloat(el.getAttribute('width')) || 0;
        const svgHeight = rect.height || parseFloat(el.getAttribute('height')) || 0;
        
        // Check for text elements (negative indicator - text SVGs are less likely to be logos)
        const hasTextElements = el.querySelector('text') !== null;
        if (hasTextElements) {
          logoSvgScore -= 50;
        }
        
        // Check for animations (positive indicator - animated SVGs are often logos)
        const hasAnimations = el.querySelector('animate, animateTransform, animateMotion') !== null;
        if (hasAnimations) {
          logoSvgScore += 30;
        }
        
        // Count paths and groups (more complex = more likely to be graphic logo)
        const pathCount = el.querySelectorAll('path').length;
        const groupCount = el.querySelectorAll('g').length;
        logoSvgScore += Math.min(pathCount * 2, 40); // Cap at 40 points
        logoSvgScore += Math.min(groupCount, 20); // Cap at 20 points
        
        // Prefer larger SVGs (graphic logos are usually larger than text)
        const area = svgWidth * svgHeight;
        if (area > 10000) logoSvgScore += 20; // Large SVGs
        else if (area > 5000) logoSvgScore += 10;
        else if (area < 1000) logoSvgScore -= 20; // Very small SVGs are often text
        
        // Prefer square-ish SVGs (icons/logos are often square)
        if (svgWidth > 0 && svgHeight > 0) {
          const aspectRatio = Math.max(svgWidth, svgHeight) / Math.min(svgWidth, svgHeight);
          if (aspectRatio < 1.5) logoSvgScore += 10; // Square-ish
          else if (aspectRatio > 5) logoSvgScore -= 15; // Very wide/tall (likely text)
        }
        
        // Check if it looks like text (simple paths forming letters)
        if (pathCount > 0 && pathCount < 20 && groupCount === 0 && !hasAnimations) {
          // Simple structure with few paths might be text
          logoSvgScore -= 30;
        }
      }
      
      let alt = "";
      let srcMatch = false;
      let altMatch = false;
      let classMatch = false;
      let hrefMatch = false;
      
      if (isSvg) {
        const svgId = el.id || "";
        const svgClass = getClassNameString(el);
        const svgAriaLabel = el.getAttribute("aria-label") || "";
        const svgTitle = el.querySelector("title")?.textContent || "";
        const svgText = el.textContent?.trim() || "";
        
        alt = svgAriaLabel || svgTitle || svgText || svgId || "";
        altMatch = /logo/i.test(svgId) || /logo/i.test(svgAriaLabel) || /logo/i.test(svgTitle);
        classMatch = /logo/i.test(svgClass);
        srcMatch = el.closest('[class*="logo" i], [id*="logo" i]') !== null;
      } else {
        const imgId = el.id || "";
        alt = el.alt || "";
        
        const idMatch = /logo/i.test(imgId);
        srcMatch = (el.src ? /logo/i.test(el.src) : false) || idMatch;
        altMatch = /logo/i.test(alt);
        
        const imgClass = getClassNameString(el);
        classMatch =
          /logo/i.test(imgClass) ||
          el.closest('[class*="logo" i], [id*="logo" i]') !== null ||
          idMatch;
      }
      
      let src = "";
      
      if (isSvg) {
        const imageEl = el.querySelector("image");
        const imageHref =
          imageEl?.getAttribute("href") ||
          imageEl?.getAttribute("xlink:href") ||
          "";
        if (imageHref) {
          try {
            src = new URL(imageHref, window.location.origin).href;
          } catch (e) {
            src = imageHref;
          }
          if (!srcMatch) srcMatch = /logo/i.test(imageHref);
        }

        if (!src) {
          try {
            const resolvedSvg = resolveSvgStyles(el);
            const serializer = new XMLSerializer();
            src =
              "data:image/svg+xml;utf8," +
              encodeURIComponent(serializer.serializeToString(resolvedSvg));
          } catch (e) {
            recordError("resolveSvgStyles", e);
            try {
              const serializer = new XMLSerializer();
              src =
                "data:image/svg+xml;utf8," +
                encodeURIComponent(serializer.serializeToString(el));
            } catch (e2) {
              recordError("XMLSerializer fallback", e2);
              recordSkip("svg-serialize-failed", el, rect);
              return;
            }
          }
        }
      } else {
        src = el.src || "";
        
        // If no src but has background-image, check if it should be treated as a logo
        // For divs with strong logo indicators, always use background-image if present
        if (!src && bgImageUrl) {
          // Check if this should be treated as a logo
          const shouldTreatAsLogo = hasBackgroundLogo || 
                                    hasLogoDataAttr || 
                                    hasLogoAriaLabel || 
                                    hasHomeHref ||
                                    (parentLink && inHeaderNav);
          
          if (debugLogo && isCalComCase) {
            console.log('🔥 [LOGO DEBUG] Should treat as logo?', {
              shouldTreatAsLogo,
              hasBackgroundLogo,
              hasLogoDataAttr,
              hasLogoAriaLabel,
              hasHomeHref,
              inHeaderNav: parentLink && inHeaderNav,
            });
          }
          
          if (shouldTreatAsLogo) {
            // Check if this is a sprite sheet
            const bgPosition = style.getPropertyValue('background-position');
            const bgSize = style.getPropertyValue('background-size');
            const isSpriteSheet = bgPosition && bgPosition !== '0px 0px' && bgPosition !== '0% 0%' && bgPosition !== '0 0';
            
            // Data URIs are already absolute, use them as-is
            if (bgImageUrl.startsWith('data:')) {
              src = bgImageUrl;
            } else {
              // Convert relative URL to absolute
              let absoluteUrl;
              try {
                const url = new URL(bgImageUrl, window.location.origin);
                absoluteUrl = url.href;
              } catch (e) {
                // If URL parsing fails, try to construct it manually
                if (bgImageUrl.startsWith('/')) {
                  absoluteUrl = window.location.origin + bgImageUrl;
                } else if (bgImageUrl.startsWith('http://') || bgImageUrl.startsWith('https://')) {
                  absoluteUrl = bgImageUrl;
                } else {
                  absoluteUrl = window.location.origin + '/' + bgImageUrl;
                }
              }
              
              // If it's a sprite sheet, try to extract the portion
              if (isSpriteSheet) {
                // Parse background-position
                const parsePosition = (pos) => {
                  if (!pos) return { x: 0, y: 0 };
                  const parts = pos.trim().split(/\s+/);
                  if (parts.length < 2) return { x: 0, y: 0 };
                  
                  let x = 0;
                  if (parts[0].endsWith('px')) {
                    x = parseFloat(parts[0]) || 0;
                  } else if (parts[0].endsWith('%')) {
                    // Percentage - would need sprite dimensions, use 0 for now
                    x = 0;
                  } else {
                    x = parseFloat(parts[0]) || 0;
                  }
                  
                  let y = 0;
                  if (parts[1].endsWith('px')) {
                    y = parseFloat(parts[1]) || 0;
                  } else if (parts[1].endsWith('%')) {
                    y = 0;
                  } else {
                    y = parseFloat(parts[1]) || 0;
                  }
                  
                  return { x: -x, y: -y }; // Negative because background-position is offset
                };
                
                const spritePosition = parsePosition(bgPosition);
                const elementWidth = Math.max(rect.width, 1);
                const elementHeight = Math.max(rect.height, 1);
                
                // Try to extract sprite portion if image is available
                // Note: This only works if the image is already in browser cache
                let extractedSprite = null;
                try {
                  // Try to find if image is already loaded (in document or cache)
                  const existingImgs = Array.from(document.images);
                  let spriteImg = existingImgs.find(img => {
                    try {
                      return img.src === absoluteUrl || img.currentSrc === absoluteUrl;
                    } catch (e) {
                      return false;
                    }
                  });
                  
                  // If not found, try to create and check cache
                  if (!spriteImg) {
                    const testImg = new Image();
                    testImg.crossOrigin = 'anonymous';
                    testImg.src = absoluteUrl;
                    // Check if immediately available (cached)
                    if (testImg.complete && testImg.naturalWidth > 0) {
                      spriteImg = testImg;
                    }
                  }
                  
                  if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0 && spriteImg.naturalHeight > 0) {
                    const spriteWidth = spriteImg.naturalWidth;
                    const spriteHeight = spriteImg.naturalHeight;
                    
                    // Calculate source coordinates in the sprite
                    // background-position like "-10px -20px" means: show sprite starting 10px from left, 20px from top
                    // So sourceX = -spritePosition.x (which is positive after negation), sourceY = -spritePosition.y
                    const sourceX = Math.max(0, -spritePosition.x);
                    const sourceY = Math.max(0, -spritePosition.y);
                    
                    // Source dimensions: use element dimensions, but clamp to sprite bounds
                    let sourceWidth = Math.min(elementWidth, spriteWidth - sourceX);
                    let sourceHeight = Math.min(elementHeight, spriteHeight - sourceY);
                    
                    // Handle background-size if specified
                    // If bgSize is like "350px", it means the sprite is scaled
                    if (bgSize && bgSize !== 'auto' && bgSize !== 'cover' && bgSize !== 'contain') {
                      const sizeMatch = bgSize.match(/(\d+(?:\.\d+)?)\s*px/i);
                      if (sizeMatch) {
                        const scaledWidth = parseFloat(sizeMatch[1]);
                        const scale = scaledWidth / spriteWidth;
                        
                        // Adjust source coordinates and dimensions for scaling
                        sourceWidth = Math.min(elementWidth / scale, spriteWidth - sourceX);
                        sourceHeight = Math.min(elementHeight / scale, spriteHeight - sourceY);
                      }
                    }
                    
                    // Ensure valid dimensions
                    if (sourceWidth > 0 && sourceHeight > 0 && 
                        sourceX < spriteWidth && sourceY < spriteHeight &&
                        sourceX + sourceWidth <= spriteWidth &&
                        sourceY + sourceHeight <= spriteHeight) {
                      
                      const canvas = document.createElement('canvas');
                      canvas.width = elementWidth;
                      canvas.height = elementHeight;
                      const ctx = canvas.getContext('2d');
                      
                      if (ctx) {
                        // Draw the sprite portion
                        // Source rectangle: (sourceX, sourceY) with size (sourceWidth, sourceHeight) from sprite
                        // Destination: full canvas (elementWidth x elementHeight)
                        ctx.drawImage(
                          spriteImg,
                          sourceX, sourceY, // Source position in sprite
                          sourceWidth, sourceHeight, // Source size in sprite
                          0, 0, // Destination position
                          elementWidth, elementHeight // Destination size (element dimensions)
                        );
                        
                        extractedSprite = canvas.toDataURL('image/png');
                      }
                    }
                  }
                } catch (e) {
                  // Extraction failed - will use metadata
                  recordError("sprite-extraction-attempt", e);
                }
                
                if (extractedSprite) {
                  // Successfully extracted sprite portion
                  src = extractedSprite;
                } else {
                  // Store metadata for backend extraction
                  src = absoluteUrl;
                  el._spriteMetadata = {
                    isSprite: true,
                    spriteUrl: absoluteUrl,
                    position: spritePosition,
                    elementWidth,
                    elementHeight,
                    backgroundSize: bgSize || 'auto',
                    backgroundPosition: bgPosition,
                  };
                }
              } else {
                // Not a sprite sheet, use URL as-is
                src = absoluteUrl;
              }
            }
            
            // Update indicators for background-image logos
            if (!srcMatch) srcMatch = /logo/i.test(bgImageUrl) || hasLogoDataAttr;
            if (!classMatch)
              classMatch =
                el.closest('[class*="logo" i], [id*="logo" i]') !== null ||
                hasLogoDataAttr;
            if (!altMatch && hasLogoAriaLabel) {
              altMatch = true;
              alt = parentAriaLabel;
            }
          }
        }
      }

      if (href) {
        const normalizedHref = href.toLowerCase().trim();
        
        hrefMatch = normalizedHref === '/' || 
                   normalizedHref === '/home' || 
                   normalizedHref === '/index' || 
                   normalizedHref === '' ||
                   normalizedHref === './'; // Also match "./" as home
        
        if (!hrefMatch && (normalizedHref.startsWith('http://') || normalizedHref.startsWith('https://') || normalizedHref.startsWith('//'))) {
          try {
            const currentHostname = window.location.hostname.toLowerCase();
            const linkUrl = new URL(href, window.location.origin);
            const linkHostname = linkUrl.hostname.toLowerCase();
            
            if (linkHostname === currentHostname && (linkUrl.pathname === '/' || linkUrl.pathname === '/home' || linkUrl.pathname === '/index.html')) {
              hrefMatch = true;
            }
          } catch (e) {}
        }
      }
      if (!hrefMatch && ariaLabelHomeMatch) {
        hrefMatch = true;
      }
      // Also set hrefMatch if we have strong logo indicators and home href
      if (!hrefMatch && hasHomeHref && (hasLogoDataAttr || hasLogoAriaLabel)) {
        hrefMatch = true;
      }

      if (src) {
        // Check if src is a data URI with SVG content
        const isSvgDataUri = src.startsWith('data:image/svg+xml');
        const finalIsSvg = isSvg || isSvgDataUri;
        
        // Debug logging for home links (even if not Cal.com case)
        const isHomeLinkCase = hasHomeHref && (isSvg || isSvgDataUri);
        
        if (debugLogo && (isCalComCase || isHomeLinkCase)) {
          console.log('🔥 [LOGO DEBUG] Adding logo candidate:', {
            src: src.substring(0, 100) + '...',
            isSvg: finalIsSvg,
            isVisible,
            location: finalInHeader ? "header" : "body",
            indicators: { inHeader: !!finalInHeader, altMatch, srcMatch, classMatch, hrefMatch },
            href,
            hasHomeHref,
            source,
          });
        }
        
        const logoCandidate = {
          src,
          alt,
          ariaLabel: candidateAriaLabel,
          isSvg: finalIsSvg,
          isVisible,
          location: finalInHeader ? "header" : "body",
          position: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          indicators: {
            inHeader: !!finalInHeader,
            altMatch,
            srcMatch,
            classMatch,
            hrefMatch,
          },
          href: href || undefined,
          source,
          logoSvgScore: finalIsSvg ? (isSvgDataUri ? 80 : logoSvgScore) : 100, // Images get high score by default, SVG data URIs get good score
        };
        
        // Add sprite metadata if this is a sprite sheet
        if (el._spriteMetadata) {
          logoCandidate.sprite = el._spriteMetadata;
        }
        
        logoCandidates.push(logoCandidate);
        recordAdd(logoCandidates[logoCandidates.length - 1]);
      } else {
        if (debugLogo && isCalComCase) {
          console.log('🔥 [LOGO DEBUG] Skipping - missing src', {
            elSrc: el.src,
            bgImageUrl: bgImageUrl ? bgImageUrl.substring(0, 100) + '...' : null,
            shouldTreatAsLogo: hasBackgroundLogo || hasLogoDataAttr || hasLogoAriaLabel || hasHomeHref || (parentLink && inHeaderNav),
          });
        }
        recordSkip("missing-src", el, rect);
      }
    };

    const allLogoSelectors = [
      'header a img, header a svg, header img, header svg',
      '[class*="header" i] a img, [class*="header" i] a svg, [class*="header" i] img, [class*="header" i] svg',
      '[id*="header" i] a img, [id*="header" i] a svg, [id*="header" i] img, [id*="header" i] svg',
      'nav a img, nav a svg, nav img, nav svg',
      '[role="banner"] a img, [role="banner"] a svg, [role="banner"] img, [role="banner"] svg',
      '#navbar a img, #navbar a svg, #navbar img, #navbar svg',
      '[id*="navbar" i] a img, [id*="navbar" i] a svg, [id*="navbar" i] img, [id*="navbar" i] svg',
      '[class*="navbar" i] a img, [class*="navbar" i] a svg, [class*="navbar" i] img, [class*="navbar" i] svg',
      'a[class*="logo" i] img, a[class*="logo" i] svg',
      'a[data-qa*="logo" i] img, a[data-qa*="logo" i] svg',
      'a[aria-label*="logo" i] img, a[aria-label*="logo" i] svg',
      '[class*="logo" i] img, [class*="logo" i] svg',
      '[id*="logo" i] img, [id*="logo" i] svg',
      'img[class*="nav-logo" i], svg[class*="nav-logo" i]',
      'img[class*="logo" i], svg[class*="logo" i]',
      // Top-level logos: SVGs/images in links with home href (href="/" or href="./")
      // These are often logos even if not in header/nav
      'a[href="/"] svg, a[href="./"] svg',
      'a[href="/"] img, a[href="./"] img',
    ];

    allLogoSelectors.forEach(selector => {
      const matches = Array.from(document.querySelectorAll(selector));
      if (debugStats) {
        debugStats.selectorCounts[selector] = matches.length;
      }
      if (debugLogo && matches.length > 0 && (selector.includes('href="/"') || selector.includes('href="./"'))) {
        console.log('🔥 [LOGO DEBUG] Home link selector matched:', selector, 'found', matches.length, 'elements');
        matches.forEach((el, idx) => {
          const parentLink = el.closest('a');
          const href = parentLink?.getAttribute('href') || '';
          console.log('🔥 [LOGO DEBUG] Home link element', idx + 1, ':', {
            tag: el.tagName,
            href,
            rect: { width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height },
          });
        });
      }
      matches.forEach(el => {
        collectLogoCandidate(el, selector);
      });
    });

    // Check for CSS background-image logos in logo containers and header links
    const logoContainerSelectors = [
      '[class*="logo" i] a',
      '[id*="logo" i] a',
      'header a[class*="logo" i]',
      'header [class*="logo" i] a',
      'nav a[class*="logo" i]',
      'nav [class*="logo" i] a',
      // Check for divs and spans inside header links (common pattern for background-image logos)
      'header a > div',
      'header a > span',
      'nav a > div',
      'nav a > span',
      '[role="banner"] a > div',
      '[role="banner"] a > span',
      // Check for elements with logo-related data attributes or aria-labels
      'a[aria-label*="logo" i] > div',
      'a[aria-label*="logo" i] > span',
      'a[aria-label*="home" i] > div',
      'a[aria-label*="home" i] > span',
      'a[href="./"] > div',
      'a[href="./"] > span',
      'a[href="/"] > div',
      'a[href="/"] > span',
      'a[href="/home"] > div',
      'a[href="/home"] > span',
      // More specific: divs/spans with logo data attributes inside links with home indicators
      'a[aria-label*="home" i] div[data-framer-name*="logo" i]',
      'a[aria-label*="home" i] span[data-framer-name*="logo" i]',
      'a[href="./"] div[data-framer-name*="logo" i]',
      'a[href="./"] span[data-framer-name*="logo" i]',
      'a[href="/"] div[data-framer-name*="logo" i]',
      'a[href="/"] span[data-framer-name*="logo" i]',
      // Also check for any div/span with logo data attribute or in logo class that has background-image
      'div[data-framer-name*="logo" i]',
      'span[data-framer-name*="logo" i]',
      'div[data-name*="logo" i]',
      'span[data-name*="logo" i]',
      // Check for elements with logo in class name that have background-image
      '[class*="logo" i][class*="shape" i]',
      '[class*="logo" i][class*="icon" i]',
      // More direct: any element with logo in class that's inside a nav/header
      'nav [class*="logo" i]',
      'header [class*="logo" i]',
      '[role="banner"] [class*="logo" i]',
    ];
    
    logoContainerSelectors.forEach(selector => {
      const matches = Array.from(document.querySelectorAll(selector));
      if (debugStats) {
        debugStats.selectorCounts[selector] = matches.length;
      }
      if (debugLogo && matches.length > 0) {
        console.log('🔥 [LOGO DEBUG] Selector matched:', selector, 'found', matches.length, 'elements');
      }
      matches.forEach(el => {
        const style = getComputedStyleCached(el);
        const bgImage = style.getPropertyValue('background-image');
        const bgImageUrl = extractBackgroundImageUrl(bgImage);
        
        // Check if element itself has logo in class name (not just parent)
        // Handle both className (string) and getAttribute('class') for compatibility
        const elClassName = (typeof el.className === 'string' ? el.className : el.getAttribute('class')) || '';
        const elHasLogoClass = /logo/i.test(elClassName);
        
        if (bgImageUrl) {
          // Check if this looks like a logo (has reasonable size and is in header/logo container)
          const rect = el.getBoundingClientRect();
          const isVisible = (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
          const hasReasonableSize = rect.width >= CONSTANTS.MIN_LOGO_SIZE && rect.height >= CONSTANTS.MIN_LOGO_SIZE;
          const inLogoContext =
            el.closest(
              '[class*="logo" i], [id*="logo" i], header, nav, [role="banner"]',
            ) !== null;
          
          // Additional checks for elements inside links
          const parentLink = el.closest('a');
          const hasLogoDataAttr = el.getAttribute('data-framer-name')?.toLowerCase().includes('logo') ||
                                  el.getAttribute('data-name')?.toLowerCase().includes('logo');
          const hasLogoAriaLabel = parentLink && /logo|home|brand/i.test(parentLink.getAttribute('aria-label') || '');
          const hasHomeHref = parentLink && isHomeHref(parentLink.getAttribute('href') || '');
          
          // For elements with strong logo indicators (logo class, data attributes, aria-labels, home hrefs),
          // be more lenient with size requirements - they might be small but still valid logos
          const hasStrongLogoIndicators = elHasLogoClass || hasLogoDataAttr || hasLogoAriaLabel || hasHomeHref;
          const sizeRequirement = hasStrongLogoIndicators 
            ? (rect.width > 0 && rect.height > 0) // Just needs to have some size
            : hasReasonableSize; // Otherwise require minimum size
          
          if (debugLogo && (elHasLogoClass || elClassName.includes('shape'))) {
            console.log('🔥 [LOGO DEBUG] Checking element with logo class:', {
              selector,
              tag: el.tagName,
              className: elClassName,
              hasBgImage: !!bgImageUrl,
              isVisible,
              sizeRequirement,
              hasReasonableSize,
              inLogoContext,
              hasStrongLogoIndicators,
              rect: { width: rect.width, height: rect.height },
            });
          }
          
          if (isVisible && sizeRequirement && (inLogoContext || hasStrongLogoIndicators)) {
            collectLogoCandidate(el, 'background-image-logo');
          } else if (debugLogo && (elHasLogoClass || elClassName.includes('shape'))) {
            console.log('🔥 [LOGO DEBUG] Element filtered out:', {
              isVisible,
              sizeRequirement,
              inLogoContext,
              hasStrongLogoIndicators,
            });
          }
        } else if (debugLogo && (elHasLogoClass || elClassName.includes('shape'))) {
          console.log('🔥 [LOGO DEBUG] Element has no background-image:', {
            selector,
            tag: el.tagName,
            className: elClassName,
            bgImage: bgImage ? bgImage.substring(0, 100) + '...' : 'none',
          });
        }
      });
    });

    // Additional pass: Check all divs and spans with background-image that have strong logo indicators
    // This catches cases where the element might not match the specific selectors above
    const allElementsWithBg = Array.from(document.querySelectorAll('div, span'));
    if (debugLogo) {
      console.log('🔥 [LOGO DEBUG] Checking', allElementsWithBg.length, 'total divs/spans for logo indicators');
    }
    
    const allDivsWithBgImage = allElementsWithBg.filter(el => {
      const style = getComputedStyleCached(el);
      const bgImage = style.getPropertyValue('background-image');
      const bgImageUrl = extractBackgroundImageUrl(bgImage);
      
      // Get element properties (needed for both debug and logic)
      const dataName = el.getAttribute('data-framer-name') || el.getAttribute('data-name') || '';
      const className = el.className || '';
      const parentLink = el.closest('a');
      const parentAria = parentLink?.getAttribute('aria-label') || '';
      const parentHref = parentLink?.getAttribute('href') || '';
      
      // Debug logging
      if (debugLogo) {
        if (dataName.toLowerCase().includes('logo') || className.toLowerCase().includes('logo') || parentAria.toLowerCase().includes('home') || parentHref === './' || parentHref === '/') {
          console.log('🔥 [LOGO DEBUG] Checking element:', {
            tag: el.tagName,
            hasBgImage: !!bgImage && bgImage !== 'none',
            bgImageUrl: bgImageUrl ? bgImageUrl.substring(0, 100) + '...' : null,
            dataName,
            className: className.substring(0, 50),
            parentAria,
            parentHref,
            rect: el.getBoundingClientRect(),
          });
        }
      }
      
      if (!bgImageUrl) return false;
      
      // Check for strong logo indicators
      const hasLogoDataAttr = el.getAttribute('data-framer-name')?.toLowerCase().includes('logo') ||
                              el.getAttribute('data-name')?.toLowerCase().includes('logo');
      const hasLogoClass = className.toLowerCase().includes('logo');
      const hasLogoAriaLabel = parentLink && /logo|home|brand/i.test(parentLink.getAttribute('aria-label') || '');
      const hasHomeHref = parentLink && isHomeHref(parentLink.getAttribute('href') || '');
      const inHeaderNav = el.closest('header, nav, [role="banner"]') !== null;
      
      const shouldInclude = hasLogoDataAttr || hasLogoClass || (hasLogoAriaLabel && hasHomeHref) || (hasLogoAriaLabel && inHeaderNav) || (hasHomeHref && inHeaderNav);
      
      // Debug logging
      if (debugLogo && shouldInclude) {
        console.log('🔥 [LOGO DEBUG] Element matches logo criteria:', {
          tag: el.tagName,
          hasLogoDataAttr,
          hasLogoClass,
          hasLogoAriaLabel,
          hasHomeHref,
          inHeaderNav,
          shouldInclude,
          bgImageUrl: bgImageUrl.substring(0, 100) + '...',
        });
      }
      
      // Be more aggressive: if we have logo data attr OR logo class OR (logo aria-label AND home href), collect it
      // Don't require header/nav context if we have strong indicators
      return shouldInclude;
    });
    
    if (debugStats) {
      debugStats.selectorCounts["elements-with-bg-image-and-logo-indicators"] = allDivsWithBgImage.length;
    }
    
    if (debugLogo) {
      console.log('🔥 [LOGO DEBUG] Found', allDivsWithBgImage.length, 'elements with bg-image and logo indicators');
    }
    
    allDivsWithBgImage.forEach(el => {
      // Check if already collected
      const rect = el.getBoundingClientRect();
      const alreadyCollected = logoCandidates.some(c => {
        return Math.abs(c.position.top - rect.top) < 1 && 
               Math.abs(c.position.left - rect.left) < 1 &&
               Math.abs(c.position.width - rect.width) < 1 &&
               Math.abs(c.position.height - rect.height) < 1;
      });
      if (!alreadyCollected) {
        if (debugLogo) {
          console.log('🔥 [LOGO DEBUG] Collecting element candidate:', {
            tag: el.tagName,
            src: extractBackgroundImageUrl(getComputedStyleCached(el).getPropertyValue('background-image'))?.substring(0, 100) + '...',
            rect,
          });
        }
        collectLogoCandidate(el, 'background-image-logo-indicators');
      } else if (debugLogo) {
        console.log('🔥 [LOGO DEBUG] Skipping element - already collected');
      }
    });

    const excludeSelectors = '[class*="testimonial"], [class*="client"], [class*="partner"], [class*="customer"], [class*="case-study"], [id*="testimonial"], [id*="client"], [id*="partner"], [id*="customer"], [id*="case-study"], footer, [class*="footer"]';
    
    const allImages = Array.from(document.images);
    if (debugStats) {
      debugStats.selectorCounts["document.images"] = allImages.length;
    }
    allImages.forEach(img => {
      if (
        /logo/i.test(img.alt || "") ||
        /logo/i.test(img.src) ||
        img.closest('[class*="logo" i]')
      ) {
        if (!img.closest(excludeSelectors)) {
          collectLogoCandidate(img, "document.images");
        }
      }
    });

    const allSvgs = Array.from(document.querySelectorAll("svg"));
    if (debugStats) {
      debugStats.selectorCounts["document.querySelectorAll(svg)"] = allSvgs.length;
    }
    allSvgs.forEach(svg => {
      const svgRect = svg.getBoundingClientRect();
      const alreadyCollected = logoCandidates.some(c => {
        if (!c.isSvg) return false;
        return Math.abs(c.position.top - svgRect.top) < 1 && 
               Math.abs(c.position.left - svgRect.left) < 1 &&
               Math.abs(c.position.width - svgRect.width) < 1 &&
               Math.abs(c.position.height - svgRect.height) < 1;
      });
      if (alreadyCollected) {
        recordSkip("svg-already-collected", svg, svgRect);
        return;
      }
      
      const insideButton = svg.closest('button, [role="button"], input[type="button"], input[type="submit"]');
      if (insideButton) {
        recordSkip("svg-inside-button", svg, svgRect);
        return;
      }
      
      // Check for UI icon indicators
      const svgId = svg.id || "";
      const svgClass = getClassNameString(svg);
      const svgAriaLabel = svg.getAttribute("aria-label") || "";
      const svgTitle = svg.querySelector("title")?.textContent || "";
      
      // Skip search icons
      const hasSearchId = /search|magnif/i.test(svgId);
      const hasSearchClass = /search|magnif/i.test(svgClass);
      const hasSearchAriaLabel = /search/i.test(svgAriaLabel);
      const hasSearchTitle = /search/i.test(svgTitle);
      
      // Only check immediate parent context, not all ancestors
      const parent = svg.parentElement;
      const isInSearchForm = parent && (
        parent.tagName === 'FORM' && /search/i.test(getClassNameString(parent) + (parent.id || '')) ||
        parent.matches && parent.matches('form[class*="search"], form[id*="search"], button[class*="search"], button[id*="search"], [role="search"]')
      );
      
      const inSearchButton = svg.closest('button[class*="search"], button[id*="search"], a[class*="search"], a[id*="search"]');
      
      const isSearchIcon = hasSearchId || hasSearchClass || hasSearchAriaLabel || hasSearchTitle || isInSearchForm || !!inSearchButton;
      
      if (isSearchIcon) {
        recordSkip("svg-search-icon", svg, svgRect);
        return;
      }
      
      // Skip other UI icons
      const isUIIcon = 
        /icon|menu|hamburger|bars|close|times|cart|user|account|profile|settings|notification|bell|chevron|arrow|caret|dropdown/i.test(svgClass) ||
        /icon|menu|hamburger|cart|user|bell/i.test(svgId) ||
        /menu|close|cart|user|settings/i.test(svgAriaLabel);
      
      const hasLogoId = /logo/i.test(svgId);
      const hasLogoClass = /logo/i.test(svgClass);
      const hasLogoAriaLabel = /logo/i.test(svgAriaLabel);
      const hasLogoTitle = /logo/i.test(svgTitle);
      const inHeaderNav = svg.closest(
        'header, nav, [role="banner"], #navbar, [id*="navbar" i], [class*="navbar" i], [id*="header" i], [class*="header" i]',
      );
      const inLogoContainer = svg.closest('[class*="logo" i], [id*="logo" i]');
      const inHeaderNavArea = !!inHeaderNav;
      const inAnchorInHeader = svg.closest('a') && inHeaderNav;
      
      // If it looks like a UI icon, only collect if it has explicit logo indicators
      if (isUIIcon) {
        const hasExplicitLogoIndicator = hasLogoId || hasLogoClass || hasLogoAriaLabel || hasLogoTitle || inLogoContainer;
        if (!hasExplicitLogoIndicator) {
          recordSkip("svg-ui-icon", svg, svgRect);
          return;
        }
      }
      
      const shouldCollect = 
        hasLogoId ||
        hasLogoClass ||
        hasLogoAriaLabel ||
        hasLogoTitle ||
        inLogoContainer ||
        inHeaderNavArea ||
        inAnchorInHeader;
      
      if (shouldCollect) {
        const excludeSelectors = '[class*="testimonial"], [class*="client"], [class*="partner"], [class*="customer"], [class*="case-study"], [id*="testimonial"], [id*="client"], [id*="partner"], [id*="customer"], [id*="case-study"], footer, [class*="footer"]';
        if (!svg.closest(excludeSelectors)) {
          collectLogoCandidate(svg, "document.querySelectorAll(svg)");
        }
      } else {
        recordSkip("svg-no-logo-indicator", svg, svgRect);
      }
    });

    const seen = new Set();
    const uniqueCandidates = logoCandidates.filter(candidate => {
      if (seen.has(candidate.src)) return false;
      seen.add(candidate.src);
      return true;
    });

    if (debugLogo) {
      console.log('🔥 [LOGO DEBUG] Summary:', {
        totalCandidates: logoCandidates.length,
        uniqueCandidates: uniqueCandidates.length,
        candidates: uniqueCandidates.map(c => ({
          src: c.src.substring(0, 100) + '...',
          source: c.source,
          isVisible: c.isVisible,
          indicators: c.indicators,
        })),
      });
    }

    let candidatesToPick = uniqueCandidates.filter(c => c.isVisible);
    if (candidatesToPick.length === 0 && uniqueCandidates.length > 0) {
      candidatesToPick = uniqueCandidates;
    }
    
    if (debugLogo) {
      console.log('🔥 [LOGO DEBUG] Selection phase:', {
        uniqueCandidates: uniqueCandidates.length,
        visibleCandidates: candidatesToPick.length,
        candidates: candidatesToPick.map(c => ({
          src: c.src.substring(0, 80) + '...',
          location: c.location,
          isVisible: c.isVisible,
          indicators: c.indicators,
          position: c.position,
        })),
      });
    }
    
    if (candidatesToPick.length > 0) {
      const best = candidatesToPick.reduce((best, candidate) => {
        if (!best) return candidate;

        const candidateArea = candidate.position.width * candidate.position.height;
        const bestArea = best.position.width * best.position.height;
        const candidateIsTiny = candidateArea < CONSTANTS.MIN_SIGNIFICANT_AREA;
        const bestIsTiny = bestArea < CONSTANTS.MIN_SIGNIFICANT_AREA;

        // Prefer non-tiny candidates before considering format (avoid tiny UI icons)
        if (candidateIsTiny && !bestIsTiny) return best;
        if (!candidateIsTiny && bestIsTiny) return candidate;
        
        // Prefer images over SVGs (images are more likely to be actual logos)
        if (!candidate.isSvg && best.isSvg) return candidate;
        if (candidate.isSvg && !best.isSvg) return best;
        
        // If both are SVGs, prefer the one with higher logo score (graphic logo vs text)
        if (candidate.isSvg && best.isSvg) {
          const candidateScore = candidate.logoSvgScore || 0;
          const bestScore = best.logoSvgScore || 0;
          if (candidateScore > bestScore) return candidate;
          if (candidateScore < bestScore) return best;
        }
        
        if (candidate.indicators.inHeader && !best.indicators.inHeader) return candidate;
        if (!candidate.indicators.inHeader && best.indicators.inHeader) return best;
        
        if (candidate.indicators.hrefMatch && !best.indicators.hrefMatch) return candidate;
        if (!candidate.indicators.hrefMatch && best.indicators.hrefMatch) return best;
        
        if (candidate.indicators.classMatch && !best.indicators.classMatch) return candidate;
        if (!candidate.indicators.classMatch && best.indicators.classMatch) return best;
        
        const candidateTooSmall = candidate.position.width < CONSTANTS.MIN_LOGO_SIZE || candidate.position.height < CONSTANTS.MIN_LOGO_SIZE;
        const bestTooSmall = best.position.width < CONSTANTS.MIN_LOGO_SIZE || best.position.height < CONSTANTS.MIN_LOGO_SIZE;
        
        if (candidateTooSmall && !bestTooSmall) return best;
        if (!candidateTooSmall && bestTooSmall) return candidate;
        
        return candidate.position.top < best.position.top ? candidate : best;
      }, null);

      if (best) {
        if (debugLogo) {
          console.log('🔥 [LOGO DEBUG] Selected best logo:', {
            src: best.src.substring(0, 100) + '...',
            isSvg: best.isSvg,
            location: best.location,
            indicators: best.indicators,
            source: best.source,
          });
        }
        if (best.isSvg) {
          push(best.src, "logo-svg");
        } else {
          push(best.src, "logo");
        }
      } else if (debugLogo) {
        console.log('🔥 [LOGO DEBUG] No best logo selected from', candidatesToPick.length, 'candidates');
      }
    } else if (debugLogo) {
      console.log('🔥 [LOGO DEBUG] No candidates to pick from', uniqueCandidates.length, 'unique candidates');
    }

    if (debugLogo) {
      console.log('🔥 [LOGO DEBUG] Final return:', {
        imagesCount: imgs.length,
        logoCandidatesCount: uniqueCandidates.length,
        images: imgs.map(i => ({ type: i.type, src: i.src.substring(0, 80) + '...' })),
      });
    }

    return { images: imgs, logoCandidates: uniqueCandidates };
  };

  const getTypography = () => {
    const pickFontStack = el => {
      return (
        getComputedStyleCached(el)
          .fontFamily?.split(",")
          .map(f => f.replace(/["']/g, "").trim())
          .filter(Boolean) || []
      );
    };

    const h1 = document.querySelector("h1") || document.body;
    const h2 = document.querySelector("h2") || h1;
    const p = document.querySelector("p") || document.body;
    const body = document.body;

    return {
      stacks: {
        body: pickFontStack(body),
        heading: pickFontStack(h1),
        paragraph: pickFontStack(p),
      },
      sizes: {
        h1: getComputedStyleCached(h1).fontSize || "32px",
        h2: getComputedStyleCached(h2).fontSize || "24px",
        body: getComputedStyleCached(p).fontSize || "16px",
      },
    };
  };

  const detectFrameworkHints = () => {
    const hints = [];

    const generator = document.querySelector('meta[name="generator"]');
    if (generator) hints.push(generator.getAttribute("content") || "");

    const scripts = Array.from(document.querySelectorAll("script[src]"))
      .map(s => s.getAttribute("src") || "")
      .filter(Boolean);

    if (
      scripts.some(s => s.includes("tailwind") || s.includes("cdn.tailwindcss"))
    ) {
      hints.push("tailwind");
    }
    if (scripts.some(s => s.includes("bootstrap"))) {
      hints.push("bootstrap");
    }
    if (scripts.some(s => s.includes("mui") || s.includes("material-ui"))) {
      hints.push("material-ui");
    }

    return hints.filter(Boolean);
  };

  const detectColorScheme = () => {
    const body = document.body;
    const html = document.documentElement;

    const hasDarkIndicator =
      html.classList.contains("dark") ||
      body.classList.contains("dark") ||
      html.classList.contains("dark-mode") ||
      body.classList.contains("dark-mode") ||
      html.getAttribute("data-theme") === "dark" ||
      body.getAttribute("data-theme") === "dark" ||
      html.getAttribute("data-bs-theme") === "dark";

    const hasLightIndicator =
      html.classList.contains("light") ||
      body.classList.contains("light") ||
      html.classList.contains("light-mode") ||
      body.classList.contains("light-mode") ||
      html.getAttribute("data-theme") === "light" ||
      body.getAttribute("data-theme") === "light" ||
      html.getAttribute("data-bs-theme") === "light";

    let prefersDark = false;
    try {
      prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e) {}

    if (hasDarkIndicator) return "dark";
    if (hasLightIndicator) return "light";

    const getEffectiveBackground = (el) => {
      let current = el;
      let depth = 0;
      while (current && depth < 10) {
        const bg = getComputedStyleCached(current).backgroundColor;
        const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
          const r = parseInt(match[1], 10);
          const g = parseInt(match[2], 10);
          const b = parseInt(match[3], 10);
          const alpha = match[4] ? parseFloat(match[4]) : 1;
          
          if (alpha > CONSTANTS.MIN_ALPHA_THRESHOLD) {
            return { r, g, b, alpha };
          }
        }
        current = current.parentElement;
        depth++;
      }
      return null;
    };

    const bodyBg = getEffectiveBackground(body);
    const htmlBg = getEffectiveBackground(html);
    const effectiveBg = bodyBg || htmlBg;

    if (effectiveBg) {
      const { r, g, b } = effectiveBg;
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      
      if (luminance < 0.4) return "dark";
      if (luminance > 0.6) return "light";
      
      return prefersDark ? "dark" : "light";
    }

    return prefersDark ? "dark" : "light";
  };

  const extractBrandName = () => {
    const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
    const title = document.title;
    const h1 = document.querySelector("h1")?.textContent?.trim();
    
    let domainName = "";
    try {
      const hostname = window.location.hostname;
      domainName = hostname.replace(/^www\./, "").split(".")[0];
      domainName = domainName.charAt(0).toUpperCase() + domainName.slice(1);
    } catch (e) {}

    let titleBrand = "";
    if (title) {
      titleBrand = title
        .replace(/\s*[-|–|—]\s*.*$/, "")
        .replace(/\s*:\s*.*$/, "")
        .replace(/\s*\|.*$/, "")
        .trim();
    }

    return ogSiteName || titleBrand || h1 || domainName || "";
  };

  const normalizeColor = (color) => {
    if (!color || typeof color !== "string") return null;
    const normalized = color.toLowerCase().trim();
    
    if (normalized === "transparent" || normalized === "rgba(0, 0, 0, 0)") {
      return null;
    }
    
    if (normalized === "#ffffff" || normalized === "#fff" || 
        normalized === "white" || normalized === "rgb(255, 255, 255)" || 
        /^rgba\(255,\s*255,\s*255(,\s*1(\.0)?)?\)$/.test(normalized)) {
      return "rgb(255, 255, 255)";
    }
    
    if (normalized === "#000000" || normalized === "#000" || 
        normalized === "black" || normalized === "rgb(0, 0, 0)" ||
        /^rgba\(0,\s*0,\s*0(,\s*1(\.0)?)?\)$/.test(normalized)) {
      return "rgb(0, 0, 0)";
    }
    
    if (normalized.startsWith("#")) {
      return normalized;
    }
    
    if (normalized.startsWith("rgb")) {
      return normalized.replace(/\s+/g, "");
    }
    
    return normalized;
  };

  const isValidBackgroundColor = (color) => {
    if (!color || typeof color !== "string") return false;
    const normalized = color.toLowerCase().trim();
    if (normalized === "transparent" || normalized === "rgba(0, 0, 0, 0)") {
      return false;
    }
    const rgbaMatch = normalized.match(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)/);
    if (rgbaMatch) {
      const alpha = parseFloat(rgbaMatch[1]);
      if (alpha < CONSTANTS.MAX_TRANSPARENT_ALPHA) {
        return false;
      }
      return true;
    }
    const colorMatch = normalized.match(/color\([^)]+\)/);
    if (colorMatch) {
      return true;
    }
    return normalized.length > 0;
  };

  const getBackgroundCandidates = () => {
    const candidates = [];
    
    const colorFrequency = new Map();
    const allSampleElements = document.querySelectorAll("body, html, main, article, [role='main'], div, section");
    const sampleElements = Array.from(allSampleElements).slice(0, CONSTANTS.MAX_BACKGROUND_SAMPLES);
    
    sampleElements.forEach(el => {
      try {
        const bg = getComputedStyleCached(el).backgroundColor;
        if (isValidBackgroundColor(bg)) {
          const rect = el.getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area > CONSTANTS.MIN_SIGNIFICANT_AREA) {
            const normalized = normalizeColor(bg);
            if (normalized) {
              const currentCount = colorFrequency.get(normalized) || 0;
              colorFrequency.set(normalized, currentCount + area);
            }
          }
        }
      } catch (e) {}
    });
    
    let mostCommonColor = null;
    let maxArea = 0;
    for (const [color, area] of colorFrequency.entries()) {
      if (area > maxArea) {
        maxArea = area;
        mostCommonColor = color;
      }
    }
    
    const bodyBg = getComputedStyleCached(document.body).backgroundColor;
    const htmlBg = getComputedStyleCached(document.documentElement).backgroundColor;
    
    if (isValidBackgroundColor(bodyBg)) {
      const normalized = normalizeColor(bodyBg);
      const priority = normalized === mostCommonColor ? 15 : 10;
      if (normalized) {
        candidates.push({
          color: normalized,
          source: "body",
          priority: priority,
        });
      }
    }
    
    if (isValidBackgroundColor(htmlBg)) {
      const normalized = normalizeColor(htmlBg);
      const priority = normalized === mostCommonColor ? 14 : 9;
      if (normalized) {
        candidates.push({
          color: normalized,
          source: "html",
          priority: priority,
        });
      }
    }
    
    const normalizedBodyBg = normalizeColor(bodyBg);
    const normalizedHtmlBg = normalizeColor(htmlBg);
    if (mostCommonColor && mostCommonColor !== normalizedBodyBg && mostCommonColor !== normalizedHtmlBg) {
      candidates.push({
        color: mostCommonColor,
        source: "most-common-visible",
        priority: 12,
        area: maxArea,
      });
    }
    
    try {
      const rootStyle = getComputedStyleCached(document.documentElement);
      
      const cssVars = [
        "--background",
        "--background-light",
        "--background-dark",
        "--bg-background",
        "--bg-background-light",
        "--bg-background-dark",
        "--color-background",
        "--color-background-light",
        "--color-background-dark",
      ];
      
      cssVars.forEach(varName => {
        try {
          const rawValue = rootStyle.getPropertyValue(varName).trim();
          
          if (rawValue && isValidBackgroundColor(rawValue)) {
            candidates.push({
              color: rawValue,
              source: "css-var:" + varName,
              priority: 8,
            });
          }
        } catch (e) {}
      });
    } catch (e) {}
    
    try {
      const allContainers = document.querySelectorAll("main, article, [role='main'], header, .main, .container");
      const mainContainers = Array.from(allContainers).slice(0, 5);
      mainContainers.forEach(el => {
        try {
          const bg = getComputedStyleCached(el).backgroundColor;
          if (isValidBackgroundColor(bg)) {
            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > CONSTANTS.MIN_LARGE_CONTAINER_AREA) {
              const normalized = normalizeColor(bg);
              if (normalized) {
                candidates.push({
                  color: normalized,
                  source: el.tagName.toLowerCase() + "-container",
                  priority: 5,
                  area: area,
                });
              }
            }
          }
        } catch (e) {}
      });
    } catch (e) {}
    
    const seen = new Set();
    const unique = candidates.filter(c => {
      if (!c || !c.color) return false;
      const key = normalizeColor(c.color);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    unique.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    return unique;
  };

  const cssData = collectCSSData();
  const elements = sampleElements();
  const snapshots = elements.map(getStyleSnapshot);
  const imageData = findImages();
  const typography = getTypography();
  const frameworkHints = detectFrameworkHints();
  const colorScheme = detectColorScheme();
  const brandName = extractBrandName();
  const backgroundCandidates = getBackgroundCandidates();
  
  const pageBackground = backgroundCandidates.length > 0 ? backgroundCandidates[0].color : null;

  return {
    branding: {
      cssData,
      snapshots,
      images: imageData.images,
      logoCandidates: imageData.logoCandidates,
      brandName,
      typography,
      frameworkHints,
      colorScheme,
      pageBackground,
      backgroundCandidates,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
})();`;
