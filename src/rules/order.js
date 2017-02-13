'use strict'

import importType from '../core/importType'
import isStaticRequire from '../core/staticRequire'

const defaultGroups = ['builtin', 'external', 'parent', 'sibling', 'index']

// REPORTING

function findOutOfOrder(imported, comparator) {
  if (imported.length === 0) {
    return []
  }
  let maxSeenRankNode = imported[0]
  return imported.filter(function (importedModule) {
    const res = comparator(importedModule, maxSeenRankNode)
    if (comparator(maxSeenRankNode, importedModule)) {
      maxSeenRankNode = importedModule
    }
    return res
  })
}

function reportOutOfOrder(context, sortedImports, outOfOrder, order, comparator) {
  // Pass in imports pre-sorted to ensure `found` is correct position
  for (let imp of outOfOrder) {
    const found = sortedImports.find(importedItem => comparator(importedItem, imp))

    context.report(imp.node, '`' + imp.name + '` import should occur ' + order +
      ' import of `' + found.name + '`')
  }
}

function makeOutOfOrderReport(context, imported, forwardSortComparator, reverseSortComparator) {
  const outOfOrder = findOutOfOrder(imported, reverseSortComparator)
  if (outOfOrder.length === 0) {
    return
  }
  // There are things to report. Try to minimize the number of reported errors.
  const reversedImported = [...imported].reverse()
  const reversedOrder = findOutOfOrder(reversedImported, forwardSortComparator)
  const sortedImports = [...imported].sort(forwardSortComparator)
  if (reversedOrder.length < outOfOrder.length) {
    reportOutOfOrder(context,
      sortedImports.reverse(),
      reversedOrder,
      'after',
      reverseSortComparator
    )
  } else {
    reportOutOfOrder(context,
      sortedImports,
      outOfOrder,
      'before',
      forwardSortComparator
    )
  }
}

// DETECTING

function computeRank(context, ranks, name, type) {
  return ranks[importType(name, context)] +
    (type === 'import' ? 0 : 100)
}

function registerNode(context, node, name, type, ranks, imported) {
  const rank = computeRank(context, ranks, name, type)
  if (rank !== -1) {
    imported.push({name, rank, node})
  }
}

function isInVariableDeclarator(node) {
  return node &&
    (node.type === 'VariableDeclarator' || isInVariableDeclarator(node.parent))
}

const types = ['builtin', 'external', 'internal', 'parent', 'sibling', 'index']

// Creates an object with type-rank pairs.
// Example: { index: 0, sibling: 1, parent: 1, external: 1, builtin: 2, internal: 2 }
// Will throw an error if it contains a type that does not exist, or has a duplicate
function convertGroupsToRanks(groups) {
  const rankObject = groups.reduce(function(res, group, index) {
    if (typeof group === 'string') {
      group = [group]
    }
    group.forEach(function(groupItem) {
      if (types.indexOf(groupItem) === -1) {
        throw new Error('Incorrect configuration of the rule: Unknown type `' +
          JSON.stringify(groupItem) + '`')
      }
      if (res[groupItem] !== undefined) {
        throw new Error('Incorrect configuration of the rule: `' + groupItem + '` is duplicated')
      }
      res[groupItem] = index
    })
    return res
  }, {})

  const omittedTypes = types.filter(function(type) {
    return rankObject[type] === undefined
  })

  return omittedTypes.reduce(function(res, type) {
    res[type] = groups.length
    return res
  }, rankObject)
}

function makeNewlinesBetweenReport (context, imported, newlinesBetweenImports) {
  const getNumberOfEmptyLinesBetween = (currentImport, previousImport) => {
    const linesBetweenImports = context.getSourceCode().lines.slice(
      previousImport.node.loc.end.line,
      currentImport.node.loc.start.line - 1
    )

    return linesBetweenImports.filter((line) => !line.trim().length).length
  }
  let previousImport = imported[0]

  imported.slice(1).forEach(function(currentImport) {
    const emptyLinesBetween = getNumberOfEmptyLinesBetween(currentImport, previousImport)

    if (newlinesBetweenImports === 'always'
        || newlinesBetweenImports === 'always-and-inside-groups') {
      if (currentImport.rank !== previousImport.rank && emptyLinesBetween === 0)
      {
        context.report(
          previousImport.node, 'There should be at least one empty line between import groups'
        )
      } else if (currentImport.rank === previousImport.rank
        && emptyLinesBetween > 0
        && newlinesBetweenImports !== 'always-and-inside-groups')
      {
        context.report(
          previousImport.node, 'There should be no empty line within import group'
        )
      }
    } else {
      if (emptyLinesBetween > 0) {
        context.report(previousImport.node, 'There should be no empty line between import groups')
      }
    }

    previousImport = currentImport
  })
}

module.exports = {
  meta: {
    docs: {},

    schema: [
      {
        type: 'object',
        properties: {
          groups: {
            type: 'array',
          },
          'newlines-between': {
            enum: [
              'ignore',
              'always',
              'always-and-inside-groups',
              'never',
            ],
          },
          'sort': {
            enum: [ 'ignore', 'alphabetical' ],
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create: function importOrderRule (context) {
    const options = context.options[0] || {}
    const newlinesBetweenImports = options['newlines-between'] || 'ignore'
    let ranks

    try {
      ranks = convertGroupsToRanks(options.groups || defaultGroups)
    } catch (error) {
      // Malformed configuration
      return {
        Program: function(node) {
          context.report(node, error.message)
        },
      }
    }
    let imported = []
    let level = 0

    function incrementLevel() {
      level++
    }
    function decrementLevel() {
      level--
    }

    function determineComparators(alphabetize) {
      let forwardSortComparator, reverseSortComparator
      if (alphabetize) {
        forwardSortComparator = (a, b) => a.rank > b.rank ||
          (a.rank === b.rank && a.name > b.name)
        reverseSortComparator = (a, b) => a.rank < b.rank ||
          (a.rank === b.rank && a.name < b.name)
      } else {
        forwardSortComparator = (a, b) => a.rank > b.rank
        reverseSortComparator = (a, b) => a.rank < b.rank
      }
      return [forwardSortComparator, reverseSortComparator]
    }

    return {
      ImportDeclaration: function handleImports(node) {
        if (node.specifiers.length) { // Ignoring unassigned imports
          const name = node.source.value
          registerNode(context, node, name, 'import', ranks, imported)
        }
      },
      CallExpression: function handleRequires(node) {
        if (level !== 0 || !isStaticRequire(node) || !isInVariableDeclarator(node.parent)) {
          return
        }
        const name = node.arguments[0].value
        registerNode(context, node, name, 'require', ranks, imported)
      },
      'Program:exit': function reportAndReset() {
        const alphabetize = (options['sort'] === 'alphabetical')
        const [forwardSortComparator, reverseSortComparator] = determineComparators(alphabetize)
        makeOutOfOrderReport(context, imported, forwardSortComparator, reverseSortComparator)

        if (newlinesBetweenImports !== 'ignore') {
          makeNewlinesBetweenReport(context, imported, newlinesBetweenImports)
        }

        imported = []
      },
      FunctionDeclaration: incrementLevel,
      FunctionExpression: incrementLevel,
      ArrowFunctionExpression: incrementLevel,
      BlockStatement: incrementLevel,
      ObjectExpression: incrementLevel,
      'FunctionDeclaration:exit': decrementLevel,
      'FunctionExpression:exit': decrementLevel,
      'ArrowFunctionExpression:exit': decrementLevel,
      'BlockStatement:exit': decrementLevel,
      'ObjectExpression:exit': decrementLevel,
    }
  },
}
