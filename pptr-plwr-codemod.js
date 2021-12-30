export default function (fileInfo, api) {
    const j = api.jscodeshift;
    const root = j(fileInfo.source);

    // If strict mode is set the codemod will act more conservatively
    // and assume all explicit waits are actually necessary 
    const MODE_STRICT = process.env.STRICT;

    // If possible, reuse existing variable names for context and page
    // otherwise, use defaults
    let varContext = 'context'
    let varPage = 'page'

    root.find(j.Identifier, { name: 'puppeteer' }).filter(path => {
        return path.parent.value.type === 'VariableDeclarator' &&
            path.parent.value.init.type === 'CallExpression' &&
            path.parent.value.init.callee.type === 'Identifier' &&
            path.parent.value.init.callee.name === 'require' &&
            path.parent.value.init.arguments[0].type === 'Literal' &&
            path.parent.value.init.arguments[0].value === 'puppeteer';
    }).replaceWith(path => {
        return j.identifier('\{ chromium \}');
    });

    root.find(j.Identifier, { name: 'puppeteer' }).replaceWith(j.identifier('chromium'));

    root.find(j.Literal).replaceWith(path => {
        if (path.value.value === 'puppeteer') {
            return j.identifier('\'playwright\'');
        }
        return path.value;
    }
    ).toSource();

    // Remove existing context creation, save context variable name for reuse
    root.find(j.VariableDeclaration).filter(path => {
        if (!path.value.declarations[0].init.argument) {
            return
        }
        if (path.value.declarations[0].init.argument.callee.property.name === "createIncognitoBrowserContext") {
            varContext = path.value.declarations[0].id.name
        }
        return path.value.declarations[0].init.argument.callee.property.name === "createIncognitoBrowserContext" &&
            path.value.declarations[0].init.argument.callee.object.name === "browser"
    }).remove()

    // Force context creation, save page variable name for reuse
    root.find(j.VariableDeclaration).filter(path => {
        if (!path.value.declarations[0].init.argument) {
            return
        }
        if (path.value.declarations[0].init.argument.callee.property.name === "newPage") {
            varPage = path.value.declarations[0].id.name
        }
        return path.value.declarations[0].init.argument.callee.property.name === "newPage" &&
            path.value.declarations[0].init.argument.callee.object.name === "browser"
    }).insertBefore(`const ${varContext} = await browser.newContext()`)

    // Page creation from context
    root.find(j.VariableDeclaration).filter(path => {
        if (!path.value.declarations[0].init.argument) {
            return
        }
        return path.value.declarations[0].init.argument.callee.property.name === "newPage" &&
            path.value.declarations[0].init.argument.callee.object.name === "browser"
    }).replaceWith(`const ${varPage} = await ${varContext}.newPage()`)

    root.find(j.Identifier, { name: 'setViewport' }).replaceWith(j.identifier('setViewportSize'));

    // Remove sleeps
    root.find(j.AwaitExpression).filter(path => {
        if (!path.value.argument.callee) {
            return false
        }
        return !MODE_STRICT && (path.value.argument.callee.name === 'sleep')
    }).remove()

      // Remove waitForTimeout and waitFor
      root.find(j.AwaitExpression).filter(path => {
        if (!path.value.argument.callee) {
            return false
        }
      console.log(path.value.argument.callee.property.name === "waitForTimeout")
        return !MODE_STRICT && (path.value.argument.callee.property.name === "waitForTimeout" || path.value.argument.callee.property.name === "waitFor")
    }).remove()

    // Remove waitForNavigation
    root.find(j.VariableDeclaration).filter(path => {
        if (!path.value.declarations[0].init.callee || !path.value.declarations[0].init.callee.property) {
            return
        }
        return !MODE_STRICT && path.value.declarations[0].init.callee.property.name === 'waitForNavigation'
    }).remove()

    // Remove navigationPromise
    root.find(j.AwaitExpression).filter(path => {
        return !MODE_STRICT && (path.value.argument.name === 'navigationPromise')
    }).remove()

    // Remove waitForNetworkIdle
    root.find(j.AwaitExpression).filter(path => {
        if (!path.value.argument.callee.property) {
            return false
        }
        return !MODE_STRICT && (path.value.argument.callee.property.name === 'waitForNetworkIdle')
    }).remove()

    // Remove waitForSelector only when returned element is not used
    root.find(j.AwaitExpression).filter(path => {
        if (!path.value.argument.callee || !path.value.argument.callee.property) {
            return false
        }
        return !MODE_STRICT && path.value.argument.callee.property.name === 'waitForSelector' &&
            path.parent.value.type !== 'VariableDeclarator'
    }).remove()

    // Update method names
    root.find(j.Identifier, { name: 'waitForXPath' }).replaceWith(j.identifier('waitForSelector'));
    root.find(j.Identifier, { name: '$x' }).replaceWith(j.identifier('$'))
    root.find(j.Identifier, { name: 'type' }).replaceWith(j.identifier('fill'));

    // Handle setting cookies
  	const varCookies = root.find(j.AwaitExpression).filter(path => {
      if (!path.value.argument.arguments[0] || !path.value.argument.arguments[0].argument) {
        return
      }
      console.log(path.value.argument.arguments[0].argument.name)
	 return path.value.argument.callee.property.name == 'setCookie'
    })
  
    if (varCookies.length > 0) {
        const elName = varCookies.get().value.argument.callee.property.name

        root.find(j.CallExpression).filter(path => {
            if (!path.value.callee.property || !path.value.callee) {
                return false
            }
            return path.value.callee.property.name == 'setCookie'
        }).replaceWith(j.callExpression(j.memberExpression(j.identifier('browserContext'), j.identifier('addCookies'), false), [j.identifier(elName)]))

        root.find(j.ExpressionStatement).filter(path => {
            if (!path.value.expression || !path.value.expression.argument) {
                return false
            }
            return path.value.expression.argument.callee.property.name === 'addCookies'
        }).insertBefore('// TODO: ensure the following line references the right context')

    }

    return root.toSource();
}
