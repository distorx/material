(function() {
'use strict';

/***************************************************

### TODO ###

**IMPLEMENTATION**

- [ ] Async loading of md-options (eg no options for one second, then they all show up).
- [ ] Implement CSS for an md-progress-circular in the select while the options are loading.
- [ ] Implement keyboard interaction
- [ ] Implement ARIA & accessibility
- [ ] Abstract the placement code from $mdSelect into a reusable $mdMenu service
- [ ] Finish theming
- [ ] Abstract placement logic in $mdSelect service to $mdMenu service

**DOCUMENTATION AND DEMOS**

- [ ] ng-model with child mdOptions (basic)
- [ ] ng-model="foo" ng-model-options="{ trackBy: '$value.id' }" for objects
- [ ] mdOption with ng-value
- [ ] mdOption with value
- [ ] Multiple repeaters full of mdOptions
- [ ] md-optgroups
- [ ] Async fetching of options with a loader
- [ ] Usage with input inside
- [ ] Usage with custom <md-select-label> element inside
- [ ] Usage with md-multiple

***************************************************/

var SELECT_EDGE_MARGIN = 8;
var SELECT_PADDING = 8;
var selectNextId = 0;

angular.module('material.components.select', [
  'material.core',
  'material.components.backdrop'
])
.directive('mdSelect', SelectDirective)
.directive('mdSelectMenu', SelectMenuDirective)
.directive('mdOption', OptionDirective)
.directive('mdOptgroup', OptgroupDirective)
.provider('$mdSelect', SelectProvider);

/**
 * @ngdoc directive
 * @name mdSelect
 * @restrict E
 * @module material.components.select
 *
 * @description Displays a select box, bound to an ng-model.
 *
 * @param {expression} ng-model The model!
 * @param {boolean=} md-multiple Whether it's multiple.
 */
function SelectDirective($mdSelect, $mdUtil) {
  return {
    restrict: 'E',
    compile: compile
  };

  function compile(element, attr) {
    var labelEl = element.find('md-select-label').remove();

    if (!labelEl.length) {
      if ( (labelEl = element.find('input')).length ) {
        labelEl.remove();
      } else if ( (labelEl = element.find('textarea')).length ) {
        labelEl.remove();
      } else if ( (labelEl = element.find('md-button')).length) {

      } else {
        labelEl = angular.element('<md-button md-ink-ripple>').html('{{' + attr.ngModel + '}}');
      }
    }
    labelEl.addClass('md-select-label');

    // There's got to be an md-content inside.
    if (!element.find('md-content').length) {
      element.append( angular.element('<md-content>').append(element.contents()) );
    }

    // We set ng-model on $parent because each select menu will open within a child scope.
    var selectTemplate = '<md-select-menu ng-model="' + attr.ngModel + '" ' +
      (angular.isDefined(attr.mdMultiple) ? 'md-multiple' : '') + '>' +
      element.html() +
    '</md-select-menu>';

    element.empty().append(labelEl);

    return function postLink(scope, element, attr) {
      var inputEl = angular.element(element[0].querySelector('input'));
      if (inputEl.length) {
        inputEl
          .on('focus', openSelect)
          .on('blur', function() {
            scope.$evalAsync($mdSelect.cancel);
          });
      } else {
        element.on('click', openSelect);
      }

      function openSelect(ev) {
        scope.$evalAsync(function() {
          $mdSelect.show({
            scope: scope,
            preserveScope: true,
            template: selectTemplate,
            target: element[0],
            inputTriggerEl: inputEl,
            hasBackdrop: inputEl.length === 0,
          });
        });
      }

    };

  }
}

function SelectMenuDirective($parse, $mdSelect, $mdUtil, $mdTheming) {

  return {
    restrict: 'E',
    require: ['mdSelectMenu', 'ngModel'],
    controller: SelectMenuController,
    link: {
      pre: preLink
    }
  };

  // We use preLink instead of postLink to ensure that the select is initialized before
  // its child options run postLink.
  function preLink(scope, element, attr, ctrls) {
    var selectCtrl = ctrls[0];
    var ngModel = ctrls[1];

    $mdTheming(element);
    element.on('click', clickListener);
    selectCtrl.init(ngModel);

    function clickListener(ev) {
      var option = $mdUtil.getClosest(ev.target, 'md-option');
      var optionCtrl = option && angular.element(option).controller('mdOption');
      if (!option || !optionCtrl) return;

      var optionHashKey = selectCtrl.hashGetter(optionCtrl.value);
      var isSelected = angular.isDefined(selectCtrl.selected[optionHashKey]);

      scope.$apply(function() {
        if (selectCtrl.isMultiple) {
          if (isSelected) {
            selectCtrl.deselect(optionHashKey);
          } else {
            selectCtrl.select(optionHashKey, optionCtrl.value);
          }
        } else {
          if (!isSelected) {
            selectCtrl.deselect( Object.keys(selectCtrl.selected)[0] );
            selectCtrl.select( optionHashKey, optionCtrl.value );
          }
        }
        selectCtrl.refreshViewValue();
      });
    }
  }

  function SelectMenuController($scope, $element, $attrs) {
    var self = this;
    self.options = {};
    self.selected = {};
    self.isMultiple = angular.isDefined($attrs.mdMultiple) || angular.isDefined($attrs.multiple);

    self.init = function(ngModel) {
      var ngModelExpr = $attrs.ngModel;
      self.ngModel = ngModel;

      if (ngModel.$options && ngModel.$options.trackBy) {
        var trackByLocals = {};
        var trackByParsed = $parse(ngModel.$options.trackBy);
        self.hashGetter = function(value, valueScope) {
          trackByLocals.$value = value;
          return trackByParsed(valueScope || $scope, trackByLocals);
        };
      } else {
        self.hashGetter = function getHashValue(value) {
          if (angular.isObject(value)) {
            return value.$$mdSelectId || (value.$$mdSelectId = ++selectNextId);
          }
          return value;
        };
      }
      if (self.isMultiple) {
        ngModel.$validators['md-multiple'] = validateArray;
        ngModel.$render = renderMultiple;

        // By default ngModel only watches a change in reference, but this allows the
        // developer to also push and pop from their array.
        $scope.$watchCollection(ngModelExpr, function(value) {
          if (validateArray(value)) renderMultiple(value);
        });
      } else {
        ngModel.$render = renderSingular;
      }

      function validateArray(modelValue, viewValue) {
        return angular.isArray(modelValue || viewValue || []);
      }
    };

    self.select = function(hashKey, hashedValue) {
      var option = self.options[hashKey];
      option && option.setSelected(true);
      self.selected[hashKey] = hashedValue;
    };
    self.deselect = function(hashKey) {
      var option = self.options[hashKey];
      option && option.setSelected(false);
      delete self.selected[hashKey];
    };

    self.addOption = function(hashKey, optionCtrl) {
      if (angular.isDefined(self.options[hashKey])) {
        throw new Error('Duplicate!');
      }
      self.options[hashKey] = optionCtrl;
      if (angular.isDefined(self.selected[hashKey])) {
        self.select(hashKey, optionCtrl.value);
        self.refreshViewValue();
      }
    };
    self.removeOption = function(hashKey, optionCtrl) {
      delete self.options[hashKey];
    };

    self.refreshViewValue = function() {
      var values = [];
      var option;
      for (var hashKey in self.selected) {
         // If this hashKey has an associated option, push that option's value to the model.
         if ((option = self.options[hashKey])) {
           values.push(option.value);
         } else {
           // Otherwise, the given hashKey has no associated option, and we got it
           // from an ngModel value at an earlier time. Push the unhashed value of
           // this hashKey to the model.
           // This allows the developer to put a value in the model that doesn't yet have
           // an associated option.
           values.push(self.selected[hashKey]);
         }
      }
      self.ngModel.$setViewValue(self.isMultiple ? values : values[0]);
    };

    function renderMultiple() {
      var newSelectedValues = self.ngModel.$modelValue || self.ngModel.$viewValue;
      if (!angular.isArray(newSelectedValues)) return;

      var oldSelected = Object.keys(self.selected);

      var newSelectedHashes = newSelectedValues.map(self.hashGetter);
      var deselected = oldSelected.filter(function(hash) {
        return newSelectedHashes.indexOf(hash) === -1;
      });
      deselected.forEach(self.deselect);
      newSelectedHashes.forEach(function(hashKey, i) {
        self.select(hashKey, newSelectedValues[i]);
      });
    }
    function renderSingular() {
      var value = self.ngModel.$viewValue || self.ngModel.$modelValue;
      Object.keys(self.selected).forEach(self.deselect);
      self.select( self.hashGetter(value), value );
    }
  }

}

function OptionDirective($mdInkRipple) {

  return {
    restrict: 'E',
    require: ['mdOption', '^^mdSelectMenu'],
    controller: OptionController,
    compile: compile
  };

  function compile(element, attr) {
    element.append( angular.element('<div class="md-text">').append(element.contents()) );
    element.attr('tabindex', '0');
    return postLink;
  }

  function postLink(scope, element, attr, ctrls) {
    var optionCtrl = ctrls[0];
    var selectCtrl = ctrls[1];

    if (angular.isDefined(attr.ngValue)) {
      scope.$watch(attr.ngValue, changeOptionValue);
    } else if (angular.isDefined(attr.value)) {
      changeOptionValue(attr.value);
    } else {
      throw new Error("Expected either ngValue or value attr");
    }

    $mdInkRipple.attachButtonBehavior(scope, element);

    function changeOptionValue(newValue, oldValue) {
      var oldHashKey = selectCtrl.hashGetter(oldValue, scope);
      var newHashKey = selectCtrl.hashGetter(newValue, scope);

      optionCtrl.hashKey = newHashKey;
      optionCtrl.value = newValue;

      selectCtrl.removeOption(oldHashKey, optionCtrl);
      selectCtrl.addOption(newHashKey, optionCtrl);
    }

    scope.$on('$destroy', function() {
      selectCtrl.removeOption(optionCtrl.hashKey, optionCtrl);
    });
  }

  function OptionController($scope, $element) {
    this.selected = false;
    this.setSelected = function(isSelected) {
      if (isSelected && !this.selected) {
        $element.attr('selected', 'selected');
      } else if (!isSelected && this.selected) {
        $element.removeAttr('selected');
      }
      this.selected = isSelected;
    };
  }

}

function OptgroupDirective() {
}

function SelectProvider($$interimElementProvider) {
  return $$interimElementProvider('$mdSelect')
    .setDefaults({
      methods: ['target'],
      options: selectDefaultOptions
    });

  /* @ngInject */
  function selectDefaultOptions($animate, $mdSelect, $mdConstant, $$rAF, $mdUtil, $mdTheming, $timeout) {
    return {
      transformTemplate: transformTemplate,
      parent: getParent,
      onShow: onShow,
      onRemove: onRemove,
      hasBackdrop: true,
      themable: true
    };

    function transformTemplate(template) {
      return '<div class="md-select-menu-container">' + template + '</div>';
    }

    function getParent(scope, element, options) {
      if (!options.target) return;
      var contentParent = angular.element(options.target).controller('mdContent');
      // If no return value, interimElement will use the default parent ($rootElement)
      return contentParent && contentParent.$element;
    }

    function onShow(scope, element, opts) {
      if (!opts.target) throw new Error("We need a target, man.");

      angular.extend(opts, {
        target: angular.element(opts.target), //make sure it's not a naked dom node
        parent: angular.element(opts.parent),
        selectEl: element.find('md-select-menu'),
        contentEl: element.find('md-content'),
        inputEl: element.find('input'),
        backdrop: opts.hasBackdrop && angular.element('<md-backdrop>')
      });

      // Only activate click listeners after a short time to stop accidental double taps/clicks
      // from clicking the wrong item
      $timeout(activateInteraction, 75, false);

      if (opts.backdrop) {
        $mdTheming.inherit(opts.backdrop, opts.target);
        opts.parent.append(opts.backdrop);
      }
      opts.parent.append(element);

      // Give the select a frame to 'initialize' in the DOM,
      // so we can read its height/width/position
      $$rAF(function() {
        if (opts.isRemoved) return;
        animateSelect(scope, element, opts);
      });

      return $mdUtil.transitionEndPromise(opts.selectEl);

      function activateInteraction() {
        if (opts.isRemoved) return;
        var selectCtrl = opts.selectEl.controller('mdSelectMenu') || {};
        element.addClass('md-clickable');

        opts.backdrop && opts.backdrop.on('click', function() {
          scope.$apply($mdSelect.cancel);
        });
        if (!selectCtrl.isMultiple) {
          opts.selectEl.on('click', function() {
            scope.$evalAsync(function() {
              $mdSelect.hide(selectCtrl.ngModel.$viewValue);
            });
          });
        }
      }

    }

    function onRemove(scope, element, opts) {
      opts.isRemoved = true;
      element.addClass('md-leave').removeClass('md-clickable');

      return $mdUtil.transitionEndPromise(element).then(function() {
        element.remove();
        opts.backdrop && opts.backdrop.remove();
      });
    }

    function animateSelect(scope, element, opts) {
      var containerNode = element[0],
          targetNode = opts.target[0],
          parentNode = opts.parent[0],
          selectNode = opts.selectEl[0],
          contentNode = opts.contentEl[0],
          inputTriggerNode = opts.inputTriggerEl && opts.inputTriggerEl[0],
          parentRect = parentNode.getBoundingClientRect(),
          targetRect = $mdUtil.clientRect(targetNode, parentNode),
          shouldOpenAroundTarget = !!inputTriggerNode,
          bounds = {
            left: parentNode.scrollLeft + SELECT_EDGE_MARGIN,
            top: parentNode.scrollTop + SELECT_EDGE_MARGIN,
            bottom: parentRect.height + parentNode.scrollTop - SELECT_EDGE_MARGIN,
            right: parentRect.width - parentNode.scrollLeft - SELECT_EDGE_MARGIN,
          },
          spaceAvailable = {
            top: targetRect.top - bounds.top,
            left: targetRect.left - bounds.bottom
          },
          maxWidth = parentRect.width - SELECT_EDGE_MARGIN * 2,
          isScrollable = contentNode.scrollHeight > contentNode.offsetHeight,
          selectedNode = selectNode.querySelector('md-option[selected]'),
          optionNodes = selectNode.getElementsByTagName('md-option'),
          centeredNode = selectedNode || optionNodes[Math.floor(optionNodes.length / 2 )];

      if (contentNode.offsetWidth > maxWidth) {
        contentNode.style['max-width'] = maxWidth + 'px';
      }
      if (shouldOpenAroundTarget) {
        contentNode.style['min-width'] = targetRect.width + 'px';
      }
      if (isScrollable) {
        selectNode.classList.add('md-overflow');
      }

      // Get the selectMenuRect *after* max-width is possibly set above
      var selectMenuRect = selectNode.getBoundingClientRect();
      var centeredRect = getOffsetRect(centeredNode);

      if (isScrollable) {
        var scrollBuffer = contentNode.offsetHeight / 2;
        contentNode.scrollTop = centeredRect.top + centeredRect.height / 2 - scrollBuffer;

        if (spaceAvailable.top < scrollBuffer) {
          contentNode.scrollTop = Math.min(
            centeredRect.top,
            contentNode.scrollTop + scrollBuffer - spaceAvailable.top
          );
        } else if (spaceAvailable.bottom < scrollBuffer) {
          contentNode.scrollTop = Math.max(
            centeredRect.top + centeredRect.height - selectMenuRect.height,
            contentNode.scrollTop - scrollBuffer + spaceAvailable.bottom
          );
        }
      }

      var left, top, transformOrigin;
      if (shouldOpenAroundTarget) {
        left = targetRect.left;
        top = targetRect.top + targetRect.height;
        transformOrigin = '50% 0';
        if (top + selectMenuRect.height > bounds.bottom) {
          top = targetRect.top - selectMenuRect.height;
          transformOrigin = '50% 100%';
        }
      } else {
        left = targetRect.left + centeredRect.left,
        top = targetRect.top + targetRect.height / 2 - centeredRect.height / 2 -
          centeredRect.top + contentNode.scrollTop;
        transformOrigin = (centeredRect.left + targetRect.width / 2) + 'px ' +
        (centeredRect.top + centeredRect.height / 2 - contentNode.scrollTop) + 'px 0px';
      }

      // Keep left and top within the window
      containerNode.style.left = clamp(bounds.left, left, bounds.right) + 'px';
      containerNode.style.top = clamp(bounds.top, top, bounds.bottom) + 'px';
      selectNode.style[$mdConstant.CSS.TRANSFORM_ORIGIN] = transformOrigin;

      selectNode.style[$mdConstant.CSS.TRANSFORM] = 'scale(' +
        Math.min(targetRect.width / selectMenuRect.width, 1.0) + ',' +
        Math.min(targetRect.height / selectMenuRect.height, 1.0) +
      ')';

      $$rAF(function() {
        element.addClass('md-active');
        selectNode.style[$mdConstant.CSS.TRANSFORM] = '';
      });
    }

  }

  function clamp(min, n, max) {
    return Math.min(max, Math.max(n, min));
  }

  function getOffsetRect(node) {
    return node ? {
      left: node.offsetLeft,
      top: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight
    } : { left: 0, top: 0, width: 0, height: 0 };
  }
}

})();
