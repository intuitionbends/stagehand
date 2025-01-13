import { generateXPathsForElement as generateXPaths } from "./xpathUtils";
import { calculateViewportHeight } from "./utils";

export function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

export function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim());
}

export async function processDom(chunksSeen: Array<number>) {
  const { chunk, chunksArray } = await pickChunk(chunksSeen);
  const { outputString, selectorMap } = await processElements(chunk);

  console.log(
    `Stagehand (Browser Process): Extracted dom elements:\n${outputString}`,
  );

  return {
    outputString,
    selectorMap,
    chunk,
    chunks: chunksArray,
  };
}

export async function processAllOfDom() {
  console.log("Stagehand (Browser Process): Processing all of DOM");

  const viewportHeight = calculateViewportHeight();
  const documentHeight = document.documentElement.scrollHeight;
  const totalChunks = Math.ceil(documentHeight / viewportHeight);

  let index = 0;
  const results = [];
  for (let chunk = 0; chunk < totalChunks; chunk++) {
    const result = await processElements(chunk, true, index);
    results.push(result);
    index += Object.keys(result.selectorMap).length;
  }

  await scrollToHeight(0);

  const allOutputString = results.map((result) => result.outputString).join("");
  const allSelectorMap = results.reduce(
    (acc, result) => ({ ...acc, ...result.selectorMap }),
    {},
  );

  console.log(
    `Stagehand (Browser Process): All dom elements: ${allOutputString}`,
  );

  return {
    outputString: allOutputString,
    selectorMap: allSelectorMap,
  };
}

export async function scrollToHeight(height: number) {
  window.scrollTo({ top: height, left: 0, behavior: "instant" });

  // Wait for scrolling to finish using the scrollend event
  await new Promise<void>((resolve) => {
    let scrollEndTimer: number;
    const handleScrollEnd = () => {
      clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        window.removeEventListener("scroll", handleScrollEnd);
        resolve();
      }, 100);
    };

    window.addEventListener("scroll", handleScrollEnd, { passive: true });
    handleScrollEnd();
  });
}

const xpathCache: Map<Node, string[]> = new Map();

export async function processElements(
  chunk: number,
  scrollToChunk: boolean = true,
  indexOffset: number = 0,
): Promise<{
  outputString: string;
  selectorMap: Record<number, string[]>;
}> {
  console.time("processElements:total");

  // Pre-calculate viewport dimensions
  const viewportHeight = calculateViewportHeight();
  const documentHeight = document.documentElement.scrollHeight;
  const maxScrollTop = documentHeight - viewportHeight;
  const offsetTop = Math.min(viewportHeight * chunk, maxScrollTop);

  // Scroll if needed (with optimized scroll handling)
  if (scrollToChunk) {
    console.time("processElements:scroll");
    await scrollToHeight(offsetTop);
    console.timeEnd("processElements:scroll");
  }

  // Use a more efficient tree walker for DOM traversal
  const treeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node: Node) => {
        // Quick rejection for non-visible or inactive elements
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (
            element.hasAttribute("hidden") ||
            element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true" ||
            getComputedStyle(element).display === "none" ||
            getComputedStyle(element).visibility === "hidden"
          ) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  console.log("Stagehand (Browser Process): Generating candidate elements");
  console.time("processElements:findCandidates");

  const candidateElements: Array<Element | Text> = [];
  const visibilityCache = new WeakMap<Element, boolean>();
  const styleCache = new WeakMap<Element, CSSStyleDeclaration>();

  // Batch DOM reads for performance
  let currentNode: Node | null;
  while ((currentNode = treeWalker.nextNode())) {
    let shouldAdd = false;

    if (currentNode.nodeType === Node.ELEMENT_NODE) {
      const element = currentNode as Element;

      // Cache computed styles
      let computedStyle = styleCache.get(element);
      if (!computedStyle) {
        computedStyle = getComputedStyle(element);
        styleCache.set(element, computedStyle);
      }

      // Quick visibility check using cached styles
      if (
        computedStyle.display === "none" ||
        computedStyle.visibility === "hidden" ||
        computedStyle.opacity === "0"
      ) {
        continue;
      }

      // Cache visibility check results
      let isElementVisible = visibilityCache.get(element);
      if (isElementVisible === undefined) {
        const rect = element.getBoundingClientRect();
        isElementVisible =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= -rect.height &&
          rect.bottom <= window.innerHeight + rect.height;
        visibilityCache.set(element, isElementVisible);
      }

      if (isElementVisible && isActive(element)) {
        if (isInteractiveElement(element) || isLeafElement(element)) {
          shouldAdd = true;
        }
      }
    } else if (currentNode.nodeType === Node.TEXT_NODE) {
      const textNode = currentNode as Text;
      if (textNode.textContent?.trim()) {
        const parent = textNode.parentElement;
        if (parent) {
          let isParentVisible = visibilityCache.get(parent);
          if (isParentVisible === undefined) {
            const computedStyle = getComputedStyle(parent);
            styleCache.set(parent, computedStyle);

            if (
              computedStyle.display === "none" ||
              computedStyle.visibility === "hidden" ||
              computedStyle.opacity === "0"
            ) {
              continue;
            }

            const rect = parent.getBoundingClientRect();
            isParentVisible =
              rect.width > 0 &&
              rect.height > 0 &&
              rect.top >= -rect.height &&
              rect.bottom <= window.innerHeight + rect.height;
            visibilityCache.set(parent, isParentVisible);
          }
          shouldAdd = isParentVisible;
        }
      }
    }

    if (shouldAdd) {
      candidateElements.push(currentNode as Element | Text);
    }
  }

  console.timeEnd("processElements:findCandidates");

  // Process candidates in parallel where possible
  console.time("processElements:processCandidates");

  // Prepare data structures
  const selectorMap: Record<number, string[]> = {};
  const outputParts: string[] = new Array(candidateElements.length);

  // Process XPaths in parallel
  const xpathPromises = candidateElements.map((element, index) => {
    if (xpathCache.has(element)) {
      return Promise.resolve({
        index,
        xpaths: xpathCache.get(element)!,
      });
    }
    return generateXPaths(element).then((xpaths) => {
      xpathCache.set(element, xpaths);
      return { index, xpaths };
    });
  });

  // Wait for all XPaths and process elements
  const results = await Promise.all(xpathPromises);

  results.forEach(({ index, xpaths }) => {
    const element = candidateElements[index];
    const actualIndex = index + indexOffset;

    selectorMap[actualIndex] = xpaths;

    if (element.nodeType === Node.TEXT_NODE) {
      const textContent = element.textContent?.trim();
      if (textContent) {
        outputParts[index] = `${actualIndex}:${textContent}\n`;
      }
    } else if (element.nodeType === Node.ELEMENT_NODE) {
      const el = element as Element;
      const tagName = el.tagName.toLowerCase();
      const attributes = collectEssentialAttributes(el);
      const textContent = el.textContent?.trim() || "";

      outputParts[index] = `${actualIndex}:<${tagName}${
        attributes ? " " + attributes : ""
      }>${textContent}</${tagName}>\n`;
    }
  });

  console.timeEnd("processElements:processCandidates");
  console.timeEnd("processElements:total");

  return {
    outputString: outputParts.join(""),
    selectorMap,
  };
}

/**
 * Collects essential attributes from an element.
 * @param element The DOM element.
 * @returns A string of formatted attributes.
 */
function collectEssentialAttributes(element: Element): string {
  const essentialAttributes = [
    "id",
    "class",
    "href",
    "src",
    "aria-label",
    "aria-name",
    "aria-role",
    "aria-description",
    "aria-expanded",
    "aria-haspopup",
    "type",
    "value",
  ];

  const attrs: string[] = essentialAttributes
    .map((attr) => {
      const value = element.getAttribute(attr);
      return value ? `${attr}="${value}"` : "";
    })
    .filter((attr) => attr !== "");

  // Collect data- attributes
  Array.from(element.attributes).forEach((attr) => {
    if (attr.name.startsWith("data-")) {
      attrs.push(`${attr.name}="${attr.value}"`);
    }
  });

  return attrs.join(" ");
}

export function storeDOM(): string {
  const originalDOM = document.body.cloneNode(true) as HTMLElement;
  console.log("DOM state stored.");
  return originalDOM.outerHTML;
}

export function restoreDOM(storedDOM: string): void {
  console.log("Restoring DOM");
  if (storedDOM) {
    document.body.innerHTML = storedDOM;
  } else {
    console.error("No DOM state was provided.");
  }
}

export function createTextBoundingBoxes(): void {
  const style = document.createElement("style");
  document.head.appendChild(style);
  if (style.sheet) {
    style.sheet.insertRule(
      `
      .stagehand-highlighted-word, .stagehand-space {
        border: 0px solid orange;
        display: inline-block !important;
        visibility: visible;
      }
    `,
      0,
    );

    style.sheet.insertRule(
      `
        code .stagehand-highlighted-word, code .stagehand-space,
        pre .stagehand-highlighted-word, pre .stagehand-space {
          white-space: pre-wrap;
          display: inline !important;
      }
     `,
      1,
    );
  }

  function applyHighlighting(root: Document | HTMLElement): void {
    root.querySelectorAll("body *").forEach((element) => {
      if (element.closest(".stagehand-nav, .stagehand-marker")) {
        return;
      }
      if (
        ["SCRIPT", "STYLE", "IFRAME", "INPUT", "TEXTAREA"].includes(
          element.tagName,
        )
      ) {
        return;
      }

      const childNodes = Array.from(element.childNodes);
      childNodes.forEach((node) => {
        if (node.nodeType === 3 && node.textContent?.trim().length > 0) {
          const textContent = node.textContent.replace(/\u00A0/g, " ");
          const tokens = textContent.split(/(\s+)/g); // Split text by spaces
          const fragment = document.createDocumentFragment();
          const parentIsCode = element.tagName === "CODE";

          tokens.forEach((token) => {
            const span = document.createElement("span");
            span.textContent = token;
            if (parentIsCode) {
              // Special handling for <code> tags
              span.style.whiteSpace = "pre-wrap";
              span.style.display = "inline";
            }
            span.className =
              token.trim().length === 0
                ? "stagehand-space"
                : "stagehand-highlighted-word";
            fragment.appendChild(span);
          });

          if (fragment.childNodes.length > 0 && node.parentNode) {
            element.insertBefore(fragment, node);
            node.remove();
          }
        }
      });
    });
  }

  applyHighlighting(document);

  document.querySelectorAll("iframe").forEach((iframe) => {
    try {
      iframe.contentWindow?.postMessage({ action: "highlight" }, "*");
    } catch (error) {
      console.error("Error accessing iframe content: ", error);
    }
  });
}

export function getElementBoundingBoxes(xpath: string): Array<{
  text: string;
  top: number;
  left: number;
  width: number;
  height: number;
}> {
  const element = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue as HTMLElement;

  if (!element) return [];

  const isValidText = (text: string) => text && text.trim().length > 0;
  let dropDownElem = element.querySelector("option[selected]");

  if (!dropDownElem) {
    dropDownElem = element.querySelector("option");
  }

  if (dropDownElem) {
    const elemText = dropDownElem.textContent || "";
    if (isValidText(elemText)) {
      const parentRect = element.getBoundingClientRect();
      return [
        {
          text: elemText.trim(),
          top: parentRect.top + window.scrollY,
          left: parentRect.left + window.scrollX,
          width: parentRect.width,
          height: parentRect.height,
        },
      ];
    } else {
      return [];
    }
  }

  let placeholderText = "";
  if (
    (element.tagName.toLowerCase() === "input" ||
      element.tagName.toLowerCase() === "textarea") &&
    (element as HTMLInputElement).placeholder
  ) {
    placeholderText = (element as HTMLInputElement).placeholder;
  } else if (element.tagName.toLowerCase() === "a") {
    placeholderText = "";
  } else if (element.tagName.toLowerCase() === "img") {
    placeholderText = (element as HTMLImageElement).alt || "";
  }

  const words = element.querySelectorAll(
    ".stagehand-highlighted-word",
  ) as NodeListOf<HTMLElement>;

  const boundingBoxes = Array.from(words)
    .map((word) => {
      const rect = word.getBoundingClientRect();
      return {
        text: word.innerText || "",
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height * 0.75,
      };
    })
    .filter(
      (box) =>
        box.width > 0 &&
        box.height > 0 &&
        box.top >= 0 &&
        box.left >= 0 &&
        isValidText(box.text),
    );

  if (boundingBoxes.length === 0) {
    const elementRect = element.getBoundingClientRect();
    return [
      {
        text: placeholderText,
        top: elementRect.top + window.scrollY,
        left: elementRect.left + window.scrollX,
        width: elementRect.width,
        height: elementRect.height * 0.75,
      },
    ];
  }

  return boundingBoxes;
}

window.processDom = processDom;
window.processAllOfDom = processAllOfDom;
window.processElements = processElements;
window.scrollToHeight = scrollToHeight;
window.storeDOM = storeDOM;
window.restoreDOM = restoreDOM;
window.createTextBoundingBoxes = createTextBoundingBoxes;
window.getElementBoundingBoxes = getElementBoundingBoxes;

const leafElementDenyList = ["SVG", "IFRAME", "SCRIPT", "STYLE", "LINK"];

const interactiveElementTypes = [
  "A",
  "BUTTON",
  "DETAILS",
  "EMBED",
  "INPUT",
  "LABEL",
  "MENU",
  "MENUITEM",
  "OBJECT",
  "SELECT",
  "TEXTAREA",
  "SUMMARY",
];

const interactiveRoles = [
  "button",
  "menu",
  "menuitem",
  "link",
  "checkbox",
  "radio",
  "slider",
  "tab",
  "tabpanel",
  "textbox",
  "combobox",
  "grid",
  "listbox",
  "option",
  "progressbar",
  "scrollbar",
  "searchbox",
  "switch",
  "tree",
  "treeitem",
  "spinbutton",
  "tooltip",
];
const interactiveAriaRoles = ["menu", "menuitem", "button"];

const isActive = (element: Element) => {
  if (
    element.hasAttribute("disabled") ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }

  return true;
};
const isInteractiveElement = (element: Element) => {
  const elementType = element.tagName;
  const elementRole = element.getAttribute("role");
  const elementAriaRole = element.getAttribute("aria-role");

  return (
    (elementType && interactiveElementTypes.includes(elementType)) ||
    (elementRole && interactiveRoles.includes(elementRole)) ||
    (elementAriaRole && interactiveAriaRoles.includes(elementAriaRole))
  );
};

const isLeafElement = (element: Element) => {
  if (element.textContent === "") {
    return false;
  }

  if (element.childNodes.length === 0) {
    return !leafElementDenyList.includes(element.tagName);
  }

  // This case ensures that extra context will be included for simple element nodes that contain only text
  if (element.childNodes.length === 1 && isTextNode(element.childNodes[0])) {
    return true;
  }

  return false;
};

async function pickChunk(chunksSeen: Array<number>) {
  const viewportHeight = calculateViewportHeight();
  const documentHeight = document.documentElement.scrollHeight;

  const chunks = Math.ceil(documentHeight / viewportHeight);

  const chunksArray = Array.from({ length: chunks }, (_, i) => i);
  const chunksRemaining = chunksArray.filter((chunk) => {
    return !chunksSeen.includes(chunk);
  });

  const currentScrollPosition = window.scrollY;
  const closestChunk = chunksRemaining.reduce((closest, current) => {
    const currentChunkTop = viewportHeight * current;
    const closestChunkTop = viewportHeight * closest;
    return Math.abs(currentScrollPosition - currentChunkTop) <
      Math.abs(currentScrollPosition - closestChunkTop)
      ? current
      : closest;
  }, chunksRemaining[0]);
  const chunk = closestChunk;

  if (chunk === undefined) {
    throw new Error(`No chunks remaining to check: ${chunksRemaining}`);
  }
  return {
    chunk,
    chunksArray,
  };
}
