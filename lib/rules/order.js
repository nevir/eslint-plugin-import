'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _importType = require('../core/importType');

var _importType2 = _interopRequireDefault(_importType);

var _staticRequire = require('../core/staticRequire');

var _staticRequire2 = _interopRequireDefault(_staticRequire);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

const defaultGroups = ['builtin', 'external', 'parent', 'sibling', 'index'];

// REPORTING

function findOutOfOrder(imported, comparator) {
  if (imported.length === 0) {
    return [];
  }
  let maxSeenRankNode = imported[0];
  return imported.filter(function (importedModule) {
    const res = comparator(importedModule, maxSeenRankNode);
    if (comparator(maxSeenRankNode, importedModule)) {
      maxSeenRankNode = importedModule;
    }
    return res;
  });
}

function reportOutOfOrder(context, sortedImports, outOfOrder, order, comparator) {
  // Pass in imports pre-sorted to ensure `found` is correct position
  for (let imp of outOfOrder) {
    const found = sortedImports.find(importedItem => comparator(importedItem, imp));

    context.report(imp.node, '`' + imp.name + '` import should occur ' + order + ' import of `' + found.name + '`');
  }
}

function makeOutOfOrderReport(context, imported, forwardSortComparator, reverseSortComparator) {
  const outOfOrder = findOutOfOrder(imported, reverseSortComparator);
  if (outOfOrder.length === 0) {
    return;
  }
  // There are things to report. Try to minimize the number of reported errors.
  const reversedImported = [].concat(_toConsumableArray(imported)).reverse();
  const reversedOrder = findOutOfOrder(reversedImported, forwardSortComparator);
  const sortedImports = [].concat(_toConsumableArray(imported)).sort(forwardSortComparator);
  if (reversedOrder.length < outOfOrder.length) {
    reportOutOfOrder(context, sortedImports.reverse(), reversedOrder, 'after', reverseSortComparator);
  } else {
    reportOutOfOrder(context, sortedImports, outOfOrder, 'before', forwardSortComparator);
  }
}

// DETECTING

function computeRank(context, ranks, name, type) {
  return ranks[(0, _importType2.default)(name, context)] + (type === 'import' ? 0 : 100);
}

function registerNode(context, node, name, type, ranks, imported) {
  const rank = computeRank(context, ranks, name, type);
  if (rank !== -1) {
    imported.push({ name, rank, node });
  }
}

function isInVariableDeclarator(node) {
  return node && (node.type === 'VariableDeclarator' || isInVariableDeclarator(node.parent));
}

const types = ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'];

// Creates an object with type-rank pairs.
// Example: { index: 0, sibling: 1, parent: 1, external: 1, builtin: 2, internal: 2 }
// Will throw an error if it contains a type that does not exist, or has a duplicate
function convertGroupsToRanks(groups) {
  const rankObject = groups.reduce(function (res, group, index) {
    if (typeof group === 'string') {
      group = [group];
    }
    group.forEach(function (groupItem) {
      if (types.indexOf(groupItem) === -1) {
        throw new Error('Incorrect configuration of the rule: Unknown type `' + JSON.stringify(groupItem) + '`');
      }
      if (res[groupItem] !== undefined) {
        throw new Error('Incorrect configuration of the rule: `' + groupItem + '` is duplicated');
      }
      res[groupItem] = index;
    });
    return res;
  }, {});

  const omittedTypes = types.filter(function (type) {
    return rankObject[type] === undefined;
  });

  return omittedTypes.reduce(function (res, type) {
    res[type] = groups.length;
    return res;
  }, rankObject);
}

function makeNewlinesBetweenReport(context, imported, newlinesBetweenImports) {
  const getNumberOfEmptyLinesBetween = (currentImport, previousImport) => {
    const linesBetweenImports = context.getSourceCode().lines.slice(previousImport.node.loc.end.line, currentImport.node.loc.start.line - 1);

    return linesBetweenImports.filter(line => !line.trim().length).length;
  };
  let previousImport = imported[0];

  imported.slice(1).forEach(function (currentImport) {
    const emptyLinesBetween = getNumberOfEmptyLinesBetween(currentImport, previousImport);

    if (newlinesBetweenImports === 'always' || newlinesBetweenImports === 'always-and-inside-groups') {
      if (currentImport.rank !== previousImport.rank && emptyLinesBetween === 0) {
        context.report(previousImport.node, 'There should be at least one empty line between import groups');
      } else if (currentImport.rank === previousImport.rank && emptyLinesBetween > 0 && newlinesBetweenImports !== 'always-and-inside-groups') {
        context.report(previousImport.node, 'There should be no empty line within import group');
      }
    } else {
      if (emptyLinesBetween > 0) {
        context.report(previousImport.node, 'There should be no empty line between import groups');
      }
    }

    previousImport = currentImport;
  });
}

module.exports = {
  meta: {
    docs: {},

    schema: [{
      type: 'object',
      properties: {
        groups: {
          type: 'array'
        },
        'newlines-between': {
          enum: ['ignore', 'always', 'always-and-inside-groups', 'never']
        },
        'sort': {
          enum: ['ignore', 'alphabetical']
        }
      },
      additionalProperties: false
    }]
  },

  create: function importOrderRule(context) {
    const options = context.options[0] || {};
    const newlinesBetweenImports = options['newlines-between'] || 'ignore';
    let ranks;

    try {
      ranks = convertGroupsToRanks(options.groups || defaultGroups);
    } catch (error) {
      // Malformed configuration
      return {
        Program: function (node) {
          context.report(node, error.message);
        }
      };
    }
    let imported = [];
    let level = 0;

    function incrementLevel() {
      level++;
    }
    function decrementLevel() {
      level--;
    }

    function determineComparators(alphabetize) {
      let forwardSortComparator, reverseSortComparator;
      if (alphabetize) {
        forwardSortComparator = (a, b) => a.rank > b.rank || a.rank === b.rank && a.name.toLowerCase() > b.name.toLowerCase();
        reverseSortComparator = (a, b) => a.rank < b.rank || a.rank === b.rank && a.name.toLowerCase() < b.name.toLowerCase();
      } else {
        forwardSortComparator = (a, b) => a.rank > b.rank;
        reverseSortComparator = (a, b) => a.rank < b.rank;
      }
      return [forwardSortComparator, reverseSortComparator];
    }

    return {
      ImportDeclaration: function handleImports(node) {
        if (node.specifiers.length) {
          // Ignoring unassigned imports
          const name = node.source.value;
          registerNode(context, node, name, 'import', ranks, imported);
        }
      },
      CallExpression: function handleRequires(node) {
        if (level !== 0 || !(0, _staticRequire2.default)(node) || !isInVariableDeclarator(node.parent)) {
          return;
        }
        const name = node.arguments[0].value;
        registerNode(context, node, name, 'require', ranks, imported);
      },
      'Program:exit': function reportAndReset() {
        const alphabetize = options['sort'] === 'alphabetical';

        var _determineComparators = determineComparators(alphabetize),
            _determineComparators2 = _slicedToArray(_determineComparators, 2);

        const forwardSortComparator = _determineComparators2[0],
              reverseSortComparator = _determineComparators2[1];

        makeOutOfOrderReport(context, imported, forwardSortComparator, reverseSortComparator);

        if (newlinesBetweenImports !== 'ignore') {
          makeNewlinesBetweenReport(context, imported, newlinesBetweenImports);
        }

        imported = [];
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
      'ObjectExpression:exit': decrementLevel
    };
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInJ1bGVzL29yZGVyLmpzIl0sIm5hbWVzIjpbImRlZmF1bHRHcm91cHMiLCJmaW5kT3V0T2ZPcmRlciIsImltcG9ydGVkIiwiY29tcGFyYXRvciIsImxlbmd0aCIsIm1heFNlZW5SYW5rTm9kZSIsImZpbHRlciIsImltcG9ydGVkTW9kdWxlIiwicmVzIiwicmVwb3J0T3V0T2ZPcmRlciIsImNvbnRleHQiLCJzb3J0ZWRJbXBvcnRzIiwib3V0T2ZPcmRlciIsIm9yZGVyIiwiaW1wIiwiZm91bmQiLCJmaW5kIiwiaW1wb3J0ZWRJdGVtIiwicmVwb3J0Iiwibm9kZSIsIm5hbWUiLCJtYWtlT3V0T2ZPcmRlclJlcG9ydCIsImZvcndhcmRTb3J0Q29tcGFyYXRvciIsInJldmVyc2VTb3J0Q29tcGFyYXRvciIsInJldmVyc2VkSW1wb3J0ZWQiLCJyZXZlcnNlIiwicmV2ZXJzZWRPcmRlciIsInNvcnQiLCJjb21wdXRlUmFuayIsInJhbmtzIiwidHlwZSIsInJlZ2lzdGVyTm9kZSIsInJhbmsiLCJwdXNoIiwiaXNJblZhcmlhYmxlRGVjbGFyYXRvciIsInBhcmVudCIsInR5cGVzIiwiY29udmVydEdyb3Vwc1RvUmFua3MiLCJncm91cHMiLCJyYW5rT2JqZWN0IiwicmVkdWNlIiwiZ3JvdXAiLCJpbmRleCIsImZvckVhY2giLCJncm91cEl0ZW0iLCJpbmRleE9mIiwiRXJyb3IiLCJKU09OIiwic3RyaW5naWZ5IiwidW5kZWZpbmVkIiwib21pdHRlZFR5cGVzIiwibWFrZU5ld2xpbmVzQmV0d2VlblJlcG9ydCIsIm5ld2xpbmVzQmV0d2VlbkltcG9ydHMiLCJnZXROdW1iZXJPZkVtcHR5TGluZXNCZXR3ZWVuIiwiY3VycmVudEltcG9ydCIsInByZXZpb3VzSW1wb3J0IiwibGluZXNCZXR3ZWVuSW1wb3J0cyIsImdldFNvdXJjZUNvZGUiLCJsaW5lcyIsInNsaWNlIiwibG9jIiwiZW5kIiwibGluZSIsInN0YXJ0IiwidHJpbSIsImVtcHR5TGluZXNCZXR3ZWVuIiwibW9kdWxlIiwiZXhwb3J0cyIsIm1ldGEiLCJkb2NzIiwic2NoZW1hIiwicHJvcGVydGllcyIsImVudW0iLCJhZGRpdGlvbmFsUHJvcGVydGllcyIsImNyZWF0ZSIsImltcG9ydE9yZGVyUnVsZSIsIm9wdGlvbnMiLCJlcnJvciIsIlByb2dyYW0iLCJtZXNzYWdlIiwibGV2ZWwiLCJpbmNyZW1lbnRMZXZlbCIsImRlY3JlbWVudExldmVsIiwiZGV0ZXJtaW5lQ29tcGFyYXRvcnMiLCJhbHBoYWJldGl6ZSIsImEiLCJiIiwidG9Mb3dlckNhc2UiLCJJbXBvcnREZWNsYXJhdGlvbiIsImhhbmRsZUltcG9ydHMiLCJzcGVjaWZpZXJzIiwic291cmNlIiwidmFsdWUiLCJDYWxsRXhwcmVzc2lvbiIsImhhbmRsZVJlcXVpcmVzIiwiYXJndW1lbnRzIiwicmVwb3J0QW5kUmVzZXQiLCJGdW5jdGlvbkRlY2xhcmF0aW9uIiwiRnVuY3Rpb25FeHByZXNzaW9uIiwiQXJyb3dGdW5jdGlvbkV4cHJlc3Npb24iLCJCbG9ja1N0YXRlbWVudCIsIk9iamVjdEV4cHJlc3Npb24iXSwibWFwcGluZ3MiOiJBQUFBOzs7O0FBRUE7Ozs7QUFDQTs7Ozs7Ozs7QUFFQSxNQUFNQSxnQkFBZ0IsQ0FBQyxTQUFELEVBQVksVUFBWixFQUF3QixRQUF4QixFQUFrQyxTQUFsQyxFQUE2QyxPQUE3QyxDQUF0Qjs7QUFFQTs7QUFFQSxTQUFTQyxjQUFULENBQXdCQyxRQUF4QixFQUFrQ0MsVUFBbEMsRUFBOEM7QUFDNUMsTUFBSUQsU0FBU0UsTUFBVCxLQUFvQixDQUF4QixFQUEyQjtBQUN6QixXQUFPLEVBQVA7QUFDRDtBQUNELE1BQUlDLGtCQUFrQkgsU0FBUyxDQUFULENBQXRCO0FBQ0EsU0FBT0EsU0FBU0ksTUFBVCxDQUFnQixVQUFVQyxjQUFWLEVBQTBCO0FBQy9DLFVBQU1DLE1BQU1MLFdBQVdJLGNBQVgsRUFBMkJGLGVBQTNCLENBQVo7QUFDQSxRQUFJRixXQUFXRSxlQUFYLEVBQTRCRSxjQUE1QixDQUFKLEVBQWlEO0FBQy9DRix3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TCxDQUFlLENBQWYsRUFBa0JILEtBQS9CO0FBQ0E3RCxxQkFBYXJCLE9BQWIsRUFBc0JTLElBQXRCLEVBQTRCQyxJQUE1QixFQUFrQyxTQUFsQyxFQUE2Q1MsS0FBN0MsRUFBb0QzQixRQUFwRDtBQUNELE9BYkk7QUFjTCxzQkFBZ0IsU0FBUzhGLGNBQVQsR0FBMEI7QUFDeEMsY0FBTVosY0FBZVIsUUFBUSxNQUFSLE1BQW9CLGNBQXpDOztBQUR3QyxvQ0FFZU8scUJBQXFCQyxXQUFyQixDQUZmO0FBQUE7O0FBQUEsY0FFakM5RCxxQkFGaUM7QUFBQSxjQUVWQyxxQkFGVTs7QUFHeENGLDZCQUFxQlgsT0FBckIsRUFBOEJSLFFBQTlCLEVBQXdDb0IscUJBQXhDLEVBQStEQyxxQkFBL0Q7O0FBRUEsWUFBSTZCLDJCQUEyQixRQUEvQixFQUF5QztBQUN2Q0Qsb0NBQTBCekMsT0FBMUIsRUFBbUNSLFFBQW5DLEVBQTZDa0Qsc0JBQTdDO0FBQ0Q7O0FBRURsRCxtQkFBVyxFQUFYO0FBQ0QsT0F4Qkk7QUF5QkwrRiwyQkFBcUJoQixjQXpCaEI7QUEwQkxpQiwwQkFBb0JqQixjQTFCZjtBQTJCTGtCLCtCQUF5QmxCLGNBM0JwQjtBQTRCTG1CLHNCQUFnQm5CLGNBNUJYO0FBNkJMb0Isd0JBQWtCcEIsY0E3QmI7QUE4Qkwsa0NBQTRCQyxjQTlCdkI7QUErQkwsaUNBQTJCQSxjQS9CdEI7QUFnQ0wsc0NBQWdDQSxjQWhDM0I7QUFpQ0wsNkJBQXVCQSxjQWpDbEI7QUFrQ0wsK0JBQXlCQTtBQWxDcEIsS0FBUDtBQW9DRDtBQXZHYyxDQUFqQiIsImZpbGUiOiJydWxlcy9vcmRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgaW1wb3J0VHlwZSBmcm9tICcuLi9jb3JlL2ltcG9ydFR5cGUnXG5pbXBvcnQgaXNTdGF0aWNSZXF1aXJlIGZyb20gJy4uL2NvcmUvc3RhdGljUmVxdWlyZSdcblxuY29uc3QgZGVmYXVsdEdyb3VwcyA9IFsnYnVpbHRpbicsICdleHRlcm5hbCcsICdwYXJlbnQnLCAnc2libGluZycsICdpbmRleCddXG5cbi8vIFJFUE9SVElOR1xuXG5mdW5jdGlvbiBmaW5kT3V0T2ZPcmRlcihpbXBvcnRlZCwgY29tcGFyYXRvcikge1xuICBpZiAoaW1wb3J0ZWQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIFtdXG4gIH1cbiAgbGV0IG1heFNlZW5SYW5rTm9kZSA9IGltcG9ydGVkWzBdXG4gIHJldHVybiBpbXBvcnRlZC5maWx0ZXIoZnVuY3Rpb24gKGltcG9ydGVkTW9kdWxlKSB7XG4gICAgY29uc3QgcmVzID0gY29tcGFyYXRvcihpbXBvcnRlZE1vZHVsZSwgbWF4U2VlblJhbmtOb2RlKVxuICAgIGlmIChjb21wYXJhdG9yKG1heFNlZW5SYW5rTm9kZSwgaW1wb3J0ZWRNb2R1bGUpKSB7XG4gICAgICBtYXhTZWVuUmFua05vZGUgPSBpbXBvcnRlZE1vZHVsZVxuICAgIH1cbiAgICByZXR1cm4gcmVzXG4gIH0pXG59XG5cbmZ1bmN0aW9uIHJlcG9ydE91dE9mT3JkZXIoY29udGV4dCwgc29ydGVkSW1wb3J0cywgb3V0T2ZPcmRlciwgb3JkZXIsIGNvbXBhcmF0b3IpIHtcbiAgLy8gUGFzcyBpbiBpbXBvcnRzIHByZS1zb3J0ZWQgdG8gZW5zdXJlIGBmb3VuZGAgaXMgY29ycmVjdCBwb3NpdGlvblxuICBmb3IgKGxldCBpbXAgb2Ygb3V0T2ZPcmRlcikge1xuICAgIGNvbnN0IGZvdW5kID0gc29ydGVkSW1wb3J0cy5maW5kKGltcG9ydGVkSXRlbSA9PiBjb21wYXJhdG9yKGltcG9ydGVkSXRlbSwgaW1wKSlcblxuICAgIGNvbnRleHQucmVwb3J0KGltcC5ub2RlLCAnYCcgKyBpbXAubmFtZSArICdgIGltcG9ydCBzaG91bGQgb2NjdXIgJyArIG9yZGVyICtcbiAgICAgICcgaW1wb3J0IG9mIGAnICsgZm91bmQubmFtZSArICdgJylcbiAgfVxufVxuXG5mdW5jdGlvbiBtYWtlT3V0T2ZPcmRlclJlcG9ydChjb250ZXh0LCBpbXBvcnRlZCwgZm9yd2FyZFNvcnRDb21wYXJhdG9yLCByZXZlcnNlU29ydENvbXBhcmF0b3IpIHtcbiAgY29uc3Qgb3V0T2ZPcmRlciA9IGZpbmRPdXRPZk9yZGVyKGltcG9ydGVkLCByZXZlcnNlU29ydENvbXBhcmF0b3IpXG4gIGlmIChvdXRPZk9yZGVyLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVyblxuICB9XG4gIC8vIFRoZXJlIGFyZSB0aGluZ3MgdG8gcmVwb3J0LiBUcnkgdG8gbWluaW1pemUgdGhlIG51bWJlciBvZiByZXBvcnRlZCBlcnJvcnMuXG4gIGNvbnN0IHJldmVyc2VkSW1wb3J0ZWQgPSBbLi4uaW1wb3J0ZWRdLnJldmVyc2UoKVxuICBjb25zdCByZXZlcnNlZE9yZGVyID0gZmluZE91dE9mT3JkZXIocmV2ZXJzZWRJbXBvcnRlZCwgZm9yd2FyZFNvcnRDb21wYXJhdG9yKVxuICBjb25zdCBzb3J0ZWRJbXBvcnRzID0gWy4uLmltcG9ydGVkXS5zb3J0KGZvcndhcmRTb3J0Q29tcGFyYXRvcilcbiAgaWYgKHJldmVyc2VkT3JkZXIubGVuZ3RoIDwgb3V0T2ZPcmRlci5sZW5ndGgpIHtcbiAgICByZXBvcnRPdXRPZk9yZGVyKGNvbnRleHQsXG4gICAgICBzb3J0ZWRJbXBvcnRzLnJldmVyc2UoKSxcbiAgICAgIHJldmVyc2VkT3JkZXIsXG4gICAgICAnYWZ0ZXInLFxuICAgICAgcmV2ZXJzZVNvcnRDb21wYXJhdG9yXG4gICAgKVxuICB9IGVsc2Uge1xuICAgIHJlcG9ydE91dE9mT3JkZXIoY29udGV4dCxcbiAgICAgIHNvcnRlZEltcG9ydHMsXG4gICAgICBvdXRPZk9yZGVyLFxuICAgICAgJ2JlZm9yZScsXG4gICAgICBmb3J3YXJkU29ydENvbXBhcmF0b3JcbiAgICApXG4gIH1cbn1cblxuLy8gREVURUNUSU5HXG5cbmZ1bmN0aW9uIGNvbXB1dGVSYW5rKGNvbnRleHQsIHJhbmtzLCBuYW1lLCB0eXBlKSB7XG4gIHJldHVybiByYW5rc1tpbXBvcnRUeXBlKG5hbWUsIGNvbnRleHQpXSArXG4gICAgKHR5cGUgPT09ICdpbXBvcnQnID8gMCA6IDEwMClcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJOb2RlKGNvbnRleHQsIG5vZGUsIG5hbWUsIHR5cGUsIHJhbmtzLCBpbXBvcnRlZCkge1xuICBjb25zdCByYW5rID0gY29tcHV0ZVJhbmsoY29udGV4dCwgcmFua3MsIG5hbWUsIHR5cGUpXG4gIGlmIChyYW5rICE9PSAtMSkge1xuICAgIGltcG9ydGVkLnB1c2goe25hbWUsIHJhbmssIG5vZGV9KVxuICB9XG59XG5cbmZ1bmN0aW9uIGlzSW5WYXJpYWJsZURlY2xhcmF0b3Iobm9kZSkge1xuICByZXR1cm4gbm9kZSAmJlxuICAgIChub2RlLnR5cGUgPT09ICdWYXJpYWJsZURlY2xhcmF0b3InIHx8IGlzSW5WYXJpYWJsZURlY2xhcmF0b3Iobm9kZS5wYXJlbnQpKVxufVxuXG5jb25zdCB0eXBlcyA9IFsnYnVpbHRpbicsICdleHRlcm5hbCcsICdpbnRlcm5hbCcsICdwYXJlbnQnLCAnc2libGluZycsICdpbmRleCddXG5cbi8vIENyZWF0ZXMgYW4gb2JqZWN0IHdpdGggdHlwZS1yYW5rIHBhaXJzLlxuLy8gRXhhbXBsZTogeyBpbmRleDogMCwgc2libGluZzogMSwgcGFyZW50OiAxLCBleHRlcm5hbDogMSwgYnVpbHRpbjogMiwgaW50ZXJuYWw6IDIgfVxuLy8gV2lsbCB0aHJvdyBhbiBlcnJvciBpZiBpdCBjb250YWlucyBhIHR5cGUgdGhhdCBkb2VzIG5vdCBleGlzdCwgb3IgaGFzIGEgZHVwbGljYXRlXG5mdW5jdGlvbiBjb252ZXJ0R3JvdXBzVG9SYW5rcyhncm91cHMpIHtcbiAgY29uc3QgcmFua09iamVjdCA9IGdyb3Vwcy5yZWR1Y2UoZnVuY3Rpb24ocmVzLCBncm91cCwgaW5kZXgpIHtcbiAgICBpZiAodHlwZW9mIGdyb3VwID09PSAnc3RyaW5nJykge1xuICAgICAgZ3JvdXAgPSBbZ3JvdXBdXG4gICAgfVxuICAgIGdyb3VwLmZvckVhY2goZnVuY3Rpb24oZ3JvdXBJdGVtKSB7XG4gICAgICBpZiAodHlwZXMuaW5kZXhPZihncm91cEl0ZW0pID09PSAtMSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0luY29ycmVjdCBjb25maWd1cmF0aW9uIG9mIHRoZSBydWxlOiBVbmtub3duIHR5cGUgYCcgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGdyb3VwSXRlbSkgKyAnYCcpXG4gICAgICB9XG4gICAgICBpZiAocmVzW2dyb3VwSXRlbV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0luY29ycmVjdCBjb25maWd1cmF0aW9uIG9mIHRoZSBydWxlOiBgJyArIGdyb3VwSXRlbSArICdgIGlzIGR1cGxpY2F0ZWQnKVxuICAgICAgfVxuICAgICAgcmVzW2dyb3VwSXRlbV0gPSBpbmRleFxuICAgIH0pXG4gICAgcmV0dXJuIHJlc1xuICB9LCB7fSlcblxuICBjb25zdCBvbWl0dGVkVHlwZXMgPSB0eXBlcy5maWx0ZXIoZnVuY3Rpb24odHlwZSkge1xuICAgIHJldHVybiByYW5rT2JqZWN0W3R5cGVdID09PSB1bmRlZmluZWRcbiAgfSlcblxuICByZXR1cm4gb21pdHRlZFR5cGVzLnJlZHVjZShmdW5jdGlvbihyZXMsIHR5cGUpIHtcbiAgICByZXNbdHlwZV0gPSBncm91cHMubGVuZ3RoXG4gICAgcmV0dXJuIHJlc1xuICB9LCByYW5rT2JqZWN0KVxufVxuXG5mdW5jdGlvbiBtYWtlTmV3bGluZXNCZXR3ZWVuUmVwb3J0IChjb250ZXh0LCBpbXBvcnRlZCwgbmV3bGluZXNCZXR3ZWVuSW1wb3J0cykge1xuICBjb25zdCBnZXROdW1iZXJPZkVtcHR5TGluZXNCZXR3ZWVuID0gKGN1cnJlbnRJbXBvcnQsIHByZXZpb3VzSW1wb3J0KSA9PiB7XG4gICAgY29uc3QgbGluZXNCZXR3ZWVuSW1wb3J0cyA9IGNvbnRleHQuZ2V0U291cmNlQ29kZSgpLmxpbmVzLnNsaWNlKFxuICAgICAgcHJldmlvdXNJbXBvcnQubm9kZS5sb2MuZW5kLmxpbmUsXG4gICAgICBjdXJyZW50SW1wb3J0Lm5vZGUubG9jLnN0YXJ0LmxpbmUgLSAxXG4gICAgKVxuXG4gICAgcmV0dXJuIGxpbmVzQmV0d2VlbkltcG9ydHMuZmlsdGVyKChsaW5lKSA9PiAhbGluZS50cmltKCkubGVuZ3RoKS5sZW5ndGhcbiAgfVxuICBsZXQgcHJldmlvdXNJbXBvcnQgPSBpbXBvcnRlZFswXVxuXG4gIGltcG9ydGVkLnNsaWNlKDEpLmZvckVhY2goZnVuY3Rpb24oY3VycmVudEltcG9ydCkge1xuICAgIGNvbnN0IGVtcHR5TGluZXNCZXR3ZWVuID0gZ2V0TnVtYmVyT2ZFbXB0eUxpbmVzQmV0d2VlbihjdXJyZW50SW1wb3J0LCBwcmV2aW91c0ltcG9ydClcblxuICAgIGlmIChuZXdsaW5lc0JldHdlZW5JbXBvcnRzID09PSAnYWx3YXlzJ1xuICAgICAgICB8fCBuZXdsaW5lc0JldHdlZW5JbXBvcnRzID09PSAnYWx3YXlzLWFuZC1pbnNpZGUtZ3JvdXBzJykge1xuICAgICAgaWYgKGN1cnJlbnRJbXBvcnQucmFuayAhPT0gcHJldmlvdXNJbXBvcnQucmFuayAmJiBlbXB0eUxpbmVzQmV0d2VlbiA9PT0gMClcbiAgICAgIHtcbiAgICAgICAgY29udGV4dC5yZXBvcnQoXG4gICAgICAgICAgcHJldmlvdXNJbXBvcnQubm9kZSwgJ1RoZXJlIHNob3VsZCBiZSBhdCBsZWFzdCBvbmUgZW1wdHkgbGluZSBiZXR3ZWVuIGltcG9ydCBncm91cHMnXG4gICAgICAgIClcbiAgICAgIH0gZWxzZSBpZiAoY3VycmVudEltcG9ydC5yYW5rID09PSBwcmV2aW91c0ltcG9ydC5yYW5rXG4gICAgICAgICYmIGVtcHR5TGluZXNCZXR3ZWVuID4gMFxuICAgICAgICAmJiBuZXdsaW5lc0JldHdlZW5JbXBvcnRzICE9PSAnYWx3YXlzLWFuZC1pbnNpZGUtZ3JvdXBzJylcbiAgICAgIHtcbiAgICAgICAgY29udGV4dC5yZXBvcnQoXG4gICAgICAgICAgcHJldmlvdXNJbXBvcnQubm9kZSwgJ1RoZXJlIHNob3VsZCBiZSBubyBlbXB0eSBsaW5lIHdpdGhpbiBpbXBvcnQgZ3JvdXAnXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGVtcHR5TGluZXNCZXR3ZWVuID4gMCkge1xuICAgICAgICBjb250ZXh0LnJlcG9ydChwcmV2aW91c0ltcG9ydC5ub2RlLCAnVGhlcmUgc2hvdWxkIGJlIG5vIGVtcHR5IGxpbmUgYmV0d2VlbiBpbXBvcnQgZ3JvdXBzJylcbiAgICAgIH1cbiAgICB9XG5cbiAgICBwcmV2aW91c0ltcG9ydCA9IGN1cnJlbnRJbXBvcnRcbiAgfSlcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIG1ldGE6IHtcbiAgICBkb2NzOiB7fSxcblxuICAgIHNjaGVtYTogW1xuICAgICAge1xuICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgIGdyb3Vwczoge1xuICAgICAgICAgICAgdHlwZTogJ2FycmF5JyxcbiAgICAgICAgICB9LFxuICAgICAgICAgICduZXdsaW5lcy1iZXR3ZWVuJzoge1xuICAgICAgICAgICAgZW51bTogW1xuICAgICAgICAgICAgICAnaWdub3JlJyxcbiAgICAgICAgICAgICAgJ2Fsd2F5cycsXG4gICAgICAgICAgICAgICdhbHdheXMtYW5kLWluc2lkZS1ncm91cHMnLFxuICAgICAgICAgICAgICAnbmV2ZXInLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgICdzb3J0Jzoge1xuICAgICAgICAgICAgZW51bTogWyAnaWdub3JlJywgJ2FscGhhYmV0aWNhbCcgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBhZGRpdGlvbmFsUHJvcGVydGllczogZmFsc2UsXG4gICAgICB9LFxuICAgIF0sXG4gIH0sXG5cbiAgY3JlYXRlOiBmdW5jdGlvbiBpbXBvcnRPcmRlclJ1bGUgKGNvbnRleHQpIHtcbiAgICBjb25zdCBvcHRpb25zID0gY29udGV4dC5vcHRpb25zWzBdIHx8IHt9XG4gICAgY29uc3QgbmV3bGluZXNCZXR3ZWVuSW1wb3J0cyA9IG9wdGlvbnNbJ25ld2xpbmVzLWJldHdlZW4nXSB8fCAnaWdub3JlJ1xuICAgIGxldCByYW5rc1xuXG4gICAgdHJ5IHtcbiAgICAgIHJhbmtzID0gY29udmVydEdyb3Vwc1RvUmFua3Mob3B0aW9ucy5ncm91cHMgfHwgZGVmYXVsdEdyb3VwcylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gTWFsZm9ybWVkIGNvbmZpZ3VyYXRpb25cbiAgICAgIHJldHVybiB7XG4gICAgICAgIFByb2dyYW06IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICAgICAgICBjb250ZXh0LnJlcG9ydChub2RlLCBlcnJvci5tZXNzYWdlKVxuICAgICAgICB9LFxuICAgICAgfVxuICAgIH1cbiAgICBsZXQgaW1wb3J0ZWQgPSBbXVxuICAgIGxldCBsZXZlbCA9IDBcblxuICAgIGZ1bmN0aW9uIGluY3JlbWVudExldmVsKCkge1xuICAgICAgbGV2ZWwrK1xuICAgIH1cbiAgICBmdW5jdGlvbiBkZWNyZW1lbnRMZXZlbCgpIHtcbiAgICAgIGxldmVsLS1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZXRlcm1pbmVDb21wYXJhdG9ycyhhbHBoYWJldGl6ZSkge1xuICAgICAgbGV0IGZvcndhcmRTb3J0Q29tcGFyYXRvciwgcmV2ZXJzZVNvcnRDb21wYXJhdG9yXG4gICAgICBpZiAoYWxwaGFiZXRpemUpIHtcbiAgICAgICAgZm9yd2FyZFNvcnRDb21wYXJhdG9yID0gKGEsIGIpID0+IGEucmFuayA+IGIucmFuayB8fFxuICAgICAgICAgIChhLnJhbmsgPT09IGIucmFuayAmJiAoYS5uYW1lLnRvTG93ZXJDYXNlKCkgPiBiLm5hbWUudG9Mb3dlckNhc2UoKSkpXG4gICAgICAgIHJldmVyc2VTb3J0Q29tcGFyYXRvciA9IChhLCBiKSA9PiBhLnJhbmsgPCBiLnJhbmsgfHxcbiAgICAgICAgICAoYS5yYW5rID09PSBiLnJhbmsgJiYgKGEubmFtZS50b0xvd2VyQ2FzZSgpIDwgYi5uYW1lLnRvTG93ZXJDYXNlKCkpKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm9yd2FyZFNvcnRDb21wYXJhdG9yID0gKGEsIGIpID0+IGEucmFuayA+IGIucmFua1xuICAgICAgICByZXZlcnNlU29ydENvbXBhcmF0b3IgPSAoYSwgYikgPT4gYS5yYW5rIDwgYi5yYW5rXG4gICAgICB9XG4gICAgICByZXR1cm4gW2ZvcndhcmRTb3J0Q29tcGFyYXRvciwgcmV2ZXJzZVNvcnRDb21wYXJhdG9yXVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBJbXBvcnREZWNsYXJhdGlvbjogZnVuY3Rpb24gaGFuZGxlSW1wb3J0cyhub2RlKSB7XG4gICAgICAgIGlmIChub2RlLnNwZWNpZmllcnMubGVuZ3RoKSB7IC8vIElnbm9yaW5nIHVuYXNzaWduZWQgaW1wb3J0c1xuICAgICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLnNvdXJjZS52YWx1ZVxuICAgICAgICAgIHJlZ2lzdGVyTm9kZShjb250ZXh0LCBub2RlLCBuYW1lLCAnaW1wb3J0JywgcmFua3MsIGltcG9ydGVkKVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgQ2FsbEV4cHJlc3Npb246IGZ1bmN0aW9uIGhhbmRsZVJlcXVpcmVzKG5vZGUpIHtcbiAgICAgICAgaWYgKGxldmVsICE9PSAwIHx8ICFpc1N0YXRpY1JlcXVpcmUobm9kZSkgfHwgIWlzSW5WYXJpYWJsZURlY2xhcmF0b3Iobm9kZS5wYXJlbnQpKSB7XG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgbmFtZSA9IG5vZGUuYXJndW1lbnRzWzBdLnZhbHVlXG4gICAgICAgIHJlZ2lzdGVyTm9kZShjb250ZXh0LCBub2RlLCBuYW1lLCAncmVxdWlyZScsIHJhbmtzLCBpbXBvcnRlZClcbiAgICAgIH0sXG4gICAgICAnUHJvZ3JhbTpleGl0JzogZnVuY3Rpb24gcmVwb3J0QW5kUmVzZXQoKSB7XG4gICAgICAgIGNvbnN0IGFscGhhYmV0aXplID0gKG9wdGlvbnNbJ3NvcnQnXSA9PT0gJ2FscGhhYmV0aWNhbCcpXG4gICAgICAgIGNvbnN0IFtmb3J3YXJkU29ydENvbXBhcmF0b3IsIHJldmVyc2VTb3J0Q29tcGFyYXRvcl0gPSBkZXRlcm1pbmVDb21wYXJhdG9ycyhhbHBoYWJldGl6ZSlcbiAgICAgICAgbWFrZU91dE9mT3JkZXJSZXBvcnQoY29udGV4dCwgaW1wb3J0ZWQsIGZvcndhcmRTb3J0Q29tcGFyYXRvciwgcmV2ZXJzZVNvcnRDb21wYXJhdG9yKVxuXG4gICAgICAgIGlmIChuZXdsaW5lc0JldHdlZW5JbXBvcnRzICE9PSAnaWdub3JlJykge1xuICAgICAgICAgIG1ha2VOZXdsaW5lc0JldHdlZW5SZXBvcnQoY29udGV4dCwgaW1wb3J0ZWQsIG5ld2xpbmVzQmV0d2VlbkltcG9ydHMpXG4gICAgICAgIH1cblxuICAgICAgICBpbXBvcnRlZCA9IFtdXG4gICAgICB9LFxuICAgICAgRnVuY3Rpb25EZWNsYXJhdGlvbjogaW5jcmVtZW50TGV2ZWwsXG4gICAgICBGdW5jdGlvbkV4cHJlc3Npb246IGluY3JlbWVudExldmVsLFxuICAgICAgQXJyb3dGdW5jdGlvbkV4cHJlc3Npb246IGluY3JlbWVudExldmVsLFxuICAgICAgQmxvY2tTdGF0ZW1lbnQ6IGluY3JlbWVudExldmVsLFxuICAgICAgT2JqZWN0RXhwcmVzc2lvbjogaW5jcmVtZW50TGV2ZWwsXG4gICAgICAnRnVuY3Rpb25EZWNsYXJhdGlvbjpleGl0JzogZGVjcmVtZW50TGV2ZWwsXG4gICAgICAnRnVuY3Rpb25FeHByZXNzaW9uOmV4aXQnOiBkZWNyZW1lbnRMZXZlbCxcbiAgICAgICdBcnJvd0Z1bmN0aW9uRXhwcmVzc2lvbjpleGl0JzogZGVjcmVtZW50TGV2ZWwsXG4gICAgICAnQmxvY2tTdGF0ZW1lbnQ6ZXhpdCc6IGRlY3JlbWVudExldmVsLFxuICAgICAgJ09iamVjdEV4cHJlc3Npb246ZXhpdCc6IGRlY3JlbWVudExldmVsLFxuICAgIH1cbiAgfSxcbn1cbiJdfQ==