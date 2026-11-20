(() => {
  const syntaxMetadata = new Set([
    "start", "end", "loc", "range", "extra", "raw", "comments", "tokens",
    "leadingComments", "trailingComments", "innerComments"
  ]);
  const flexibleDeclarations = new Set(["q2", "q4", "q5", "q14", "q26", "q30", "q31"]);
  const callbackQuestions = new Set(["q5", "q14", "q31", "q58", "q59"]);
  const handlerQuestions = new Set(["q23", "q24", "q79", "q80"]);
  const explicitClosing = new Set(["q71", "q75", "q79"]);

  function signature(value) {
    return JSON.stringify(value, (_, item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
    });
  }

  function literal(value) {
    return { type: "Literal", value };
  }

  function getJsSignature(code, syntax, id) {
    const plugins = syntax === "jsx" ? ["estree", "jsx"] : ["estree"];
    const program = globalThis.appDevParser.parse(code, {
      sourceType: "module",
      allowUndeclaredExports: true,
      plugins
    }).program;
    const body = program.body.filter(node => node.type !== "EmptyStatement");
    const normalized = normalizeNode(body, id);
    if (flexibleDeclarations.has(id) && normalized[0]?.type === "VariableDeclaration") {
      normalized[0].kind = "declaration";
    }
    return signature(normalized);
  }

  function normalizeNode(node, id) {
    if (Array.isArray(node)) return node.map(child => normalizeNode(child, id));
    if (!node || typeof node !== "object") return node;

    switch (node.type) {
      case "Literal":
        return node.regex || node.bigint !== undefined
          ? { type: "Literal", regex: node.regex, bigint: node.bigint }
          : literal(node.value);
      case "JSXElement":
        return {
          type: node.type,
          name: normalizeNode(node.openingElement.name, id),
          attributes: normalizeNode(node.openingElement.attributes, id),
          children: normalizeJsxChildren(node.children, id),
          ...(explicitClosing.has(id) && { selfClosing: node.openingElement.selfClosing })
        };
      case "JSXFragment":
        return { type: node.type, children: normalizeJsxChildren(node.children, id) };
      case "JSXExpressionContainer":
        return normalizeNode(node.expression, id);
      case "TemplateElement":
        return literal(node.value.cooked);
    }

    const normalized = Object.fromEntries(
      Object.entries(node).filter(([key]) => !syntaxMetadata.has(key))
        .map(([key, value]) => [key, normalizeNode(value, id)])
    );
    normalizeProperty(normalized);
    normalizeFunction(normalized, id);
    normalizeTemplate(normalized, id);
    normalizeControlFlow(normalized, id);

    if (["ObjectExpression", "ObjectPattern"].includes(normalized.type) &&
        ["q2", "q15", "q25"].includes(id)) {
      const keys = normalized.properties.map(property => property.key?.value);
      if (keys.every(key => typeof key === "string") && new Set(keys).size === keys.length) {
        normalized.properties.sort((first, second) => first.key.value.localeCompare(second.key.value));
      }
    }
    if (normalized.type === "ImportDeclaration" &&
        normalized.specifiers.every(specifier => specifier.type === "ImportSpecifier")) {
      normalized.specifiers.sort((first, second) => first.local.name.localeCompare(second.local.name));
    }
    return normalized;
  }

  function normalizeJsxChildren(children, id) {
    const result = [];
    for (const child of children) {
      const value = normalizeNode(child, id);
      if (value.type === "JSXEmptyExpression") continue;
      const text = value.type === "JSXText" || (value.type === "Literal" && typeof value.value === "string");
      if (!text) {
        result.push(value);
        continue;
      }
      if (!value.value.trim() && ["q46", "q75"].includes(id)) continue;
      const previous = result.at(-1);
      if (previous?.type === "JSXText") previous.value += value.value;
      else result.push({ type: "JSXText", value: value.value });
    }
    return result;
  }

  function normalizeProperty(node) {
    if (!["MemberExpression", "Property"].includes(node.type)) return;
    const field = node.type === "Property" ? "key" : "property";
    const key = node[field];
    if (!node.computed && key.type === "Identifier") node[field] = literal(key.name);
    if (key.type === "Literal" && typeof key.value === "string" &&
        !(node.type === "Property" && key.value === "__proto__")) node.computed = false;
    if (node.type === "Property") node.shorthand = false;
  }

  function normalizeFunction(node, id) {
    const isArrow = node.type === "ArrowFunctionExpression";
    const isCallback = node.type === "FunctionExpression" && callbackQuestions.has(id);
    if ((!isArrow && !isCallback) || node.async || node.generator || id === "q4") return;

    let expression = node.body;
    if (node.body.type === "BlockStatement") {
      const statements = node.body.body.filter(statement => statement.type !== "EmptyStatement");
      if (statements.length !== 1) return;
      const statement = statements[0];
      if (statement.type === "ReturnStatement") expression = statement.argument;
      else if (statement.type === "ExpressionStatement" && handlerQuestions.has(id)) expression = statement.expression;
      else return;
    }
    if (!expression) return;
    node.type = "ExpressionCallback";
    delete node.id;
    delete node.expression;
    delete node.generator;
    node.body = expression;

    // The map question specifies the transformation, not the callback parameter name.
    if (id === "q5" && node.params.length === 1 && node.params[0].type === "Identifier" &&
        expression.type === "BinaryExpression" && expression.operator === "+" &&
        expression.right.type === "Identifier" && expression.right.name === node.params[0].name) {
      node.params[0].name = "food";
      expression.right.name = "food";
    }
  }

  function normalizeTemplate(node, id) {
    if (node.type !== "TemplateLiteral") return;
    if (node.expressions.length === 0) {
      node.type = "Literal";
      node.value = node.quasis[0].value;
    } else if (["q4", "q5"].includes(id) && node.expressions.length === 1 &&
               node.expressions[0].type === "Identifier" && node.quasis[1].value === "") {
      node.type = "BinaryExpression";
      node.operator = "+";
      node.left = node.quasis[0];
      node.right = node.expressions[0];
    } else {
      return;
    }
    delete node.quasis;
    delete node.expressions;
  }

  function normalizeControlFlow(node, id) {
    if (["ForStatement", "ForOfStatement", "WhileStatement", "IfStatement"].includes(node.type)) {
      for (const key of ["body", "consequent", "alternate"]) {
        const branch = node[key];
        if (branch?.type === "BlockStatement" && branch.body.length === 1 &&
            branch.body[0].type === "ExpressionStatement") node[key] = branch.body[0];
      }
    }
    if (id === "q3" && node.type === "ForStatement" && ["let", "var"].includes(node.init?.kind)) {
      node.init.kind = "loop variable";
    }
    if (["q3", "q21"].includes(id)) {
      const variable = id === "q3" ? "i" : "count";
      const isVariable = value => value?.type === "Identifier" && value.name === variable;
      if (node.type === "UpdateExpression" && node.operator === "++" && isVariable(node.argument)) {
        node.prefix = false;
      }
      const incrementsByOne = node.operator === "+=" && node.right?.type === "Literal" && node.right.value === 1;
      const addsOne = node.operator === "=" && node.right?.type === "BinaryExpression" &&
        node.right.operator === "+" && isVariable(node.right.left) &&
        node.right.right.type === "Literal" && node.right.right.value === 1;
      if (node.type === "AssignmentExpression" && isVariable(node.left) && (incrementsByOne || addsOne)) {
        node.type = "UpdateExpression";
        node.operator = "++";
        node.prefix = false;
        node.argument = node.left;
        delete node.left;
        delete node.right;
      }
    }
    if (node.type === "BinaryExpression") {
      const reverse = { ">": "<", ">=": "<=", "<": ">", "<=": ">=" };
      if (Object.hasOwn(reverse, node.operator) && node.left.type === "Literal" && node.right.type !== "Literal") {
        node.operator = reverse[node.operator];
        [node.left, node.right] = [node.right, node.left];
      }
      if (["q3", "q21"].includes(id) && node.operator === "<=" &&
          node.right.type === "Literal" && Number.isSafeInteger(node.right.value)) {
        node.operator = "<";
        node.right.value++;
      }
      if (["===", "!==", "*"].includes(node.operator) && node.left.type === "Literal" &&
          node.right.type === "Identifier") [node.left, node.right] = [node.right, node.left];
    }
  }

  function getCssSignature(code, id) {
    const source = code.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
    const media = id === "q41"
      ? source.match(/^@media\s*(\([^()]+\))\s*\{\s*([^{}]+\{[^{}]*\})\s*\}$/i)
      : null;
    if (id === "q41" && !media) return null;
    if (media && !/^\(\s*(?:max-width\s*:\s*900px|width\s*<=\s*900px|900px\s*>=\s*width)\s*\)$/i.test(media[1])) return null;
    const rule = (media ? media[2] : source).match(/^([^{}]+)\{([^{}]+)\}$/);
    if (!rule) return null;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(source);
    if (sheet.cssRules.length !== 1) return null;
    let cssRule = sheet.cssRules[0];
    if (media) {
      if (cssRule.type !== CSSRule.MEDIA_RULE || cssRule.cssRules.length !== 1) return null;
      cssRule = cssRule.cssRules[0];
    }
    if (cssRule.type !== CSSRule.STYLE_RULE) return null;

    const declarations = new Map();
    const scratch = document.createElement("div").style;
    for (const line of rule[2].split(";")) {
      if (!line.trim()) continue;
      const declaration = line.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*$/);
      if (!declaration) return null;
      const [, rawName, value] = declaration;
      const name = rawName.startsWith("--") ? rawName : rawName.toLowerCase();
      if (declarations.has(name)) return null;
      scratch.cssText = "";
      scratch.setProperty(name, value);
      let normalized = scratch.getPropertyValue(name).trim();
      if (!normalized) return null;
      normalized = normalized.replace(/^calc\((-?(?:\d+(?:\.\d+)?|\.\d+)(?:[a-z]+|%))\)$/i, "$1");
      if (id === "q7") normalized = normalized.toLowerCase();
      if (id === "q38" && name === "border-radius" && value.split(/\s+/).length !== 4) return null;
      if (id === "q67" && name === "border" && !/^1(?:\.0+)?px\s+solid\s+var\(/i.test(value)) return null;
      declarations.set(name, normalized);
    }
    return signature({ selector: cssRule.selectorText, declarations: Object.fromEntries(declarations) });
  }

  globalThis.appDevAnswerSignature = (code, syntax, id) => {
    try {
      return syntax === "css" ? getCssSignature(code, id) : getJsSignature(code, syntax, id);
    } catch {
      return null;
    }
  };
})();
