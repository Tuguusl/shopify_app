import BaseApp from 'base_app';
import $ from 'jquery';

import TweenMax from 'gsap';

var gravatar = require('gravatar');

var ShopifyApp = {
  ordersShown: false,

  orderLimit: 3,

  noteCharacterLimit: 165,

  orderFieldsMap: {
    "items_purchased": "line_items",
    "item_quantity": "quantity",
    "item_price": "price",
    "purchase_total": "total_price",
    "order_status": "fulfillment_status",
    "date_ordered": "created_at",
    "shipping_address": "shipping_address",
    "shipping_method": "shipping_lines",
    "billing_address": "billing_address",
    "order_notes": "note"
  },

  defaultState: 'loading',

  storeUrl: '',

  resources: {
    PROFILE_URI       : '/admin/customers/search.json',
    CUSTOMER_URI      : '/admin/customers/',
    ORDERS_URI        : '/admin/orders.json',
    ORDER_PATH        : '/admin/orders/'
  },

  requests: {
    'getProfile' : function(email) {
      var request = this.getRequest(this.resources.PROFILE_URI);

      request.data = {
        query: 'email:' + email,
        fields: 'id,note,email,first_name,last_name'
      };

      return request;
    },
    'getOrders' : function(customer_id) {
      var self = this;
      var additional_fields = 'name,id,currency,fulfillments';
      var fields = _.reject(this.orderFieldsMap, function(value, key) {
        return !self.setting(key);
      });

      if (_.size(fields) > 0) {
        additional_fields += ',' + fields.join();
      }

      var request = this.getRequest(this.resources.ORDERS_URI);

      request.data = {
        customer_id: customer_id,
        fields: additional_fields,
        status: 'any',
        limit: this.orderLimit
      };

      return request;
    },
    'getOrder': function(order_id) {
      return this.getRequest(this.resources.ORDER_PATH + order_id + '.json');
    }
  },

  events: {
    'app.created': 'init',
    'ticket.requester.email.changed' : 'queryCustomer',
    'getProfile.done' : 'handleProfile',
    'getProfile.fail' : 'handleProfileFail',
    'getOrders.done' : 'handleOrders',
    'getOrders.fail' : 'handleOrdersFail',
    'getOrder.done' : 'handleOrder',
    'getOrder.fail' : 'handleOrdersFail',
    'shown.bs.collapse .panel-group': 'resizeApp',
    'hidden.bs.collapse .panel-group': 'resizeApp',
    'click #orders-toggle': 'toggleOrders'
  },

  init: function() {
    this.storeUrl = this.storeUrl || this.checkStoreUrl(this.setting('url'));

    this.loadSprites();

    if (this.currentLocation() === 'ticket_sidebar') {
      this.queryCustomer();
    }
  },

  getRequest: function(resource) {
    return {
      headers  : {
        'X-Shopify-Access-Token': this.setting('access_token'),
        'X-Requested-With': 'XMLHttpRequest'
      },
      url      : this.storeUrl + resource,
      method   : 'GET',
      dataType : 'json'
    };
  },

  handleProfile: function(data) {
    if (data.errors) {
      this.showError(null, data.errors);
      return;
    }

    if (data.customers.length === 0) {
      this.showError(this.I18n.t('global.error.customerNotFound'), " ");
      return;
    }

    this.customer = data.customers[0];

    if (this.setting('customer_notes') && (this.customer.note === "" || this.customer.note === null)) {
      this.customer.note = this.I18n.t('customer.no_notes');
    } else {
      this.customer.note = this.truncateTextToLimit(this.customer.note);
    }

    this.customer.uri = this.storeUrl + this.resources.CUSTOMER_URI + this.customer.id;
    this.customer.image = gravatar.url(this.customer.email, {s: 20, d: 'mm'});

    this.switchTo('customer', {
      customer: this.customer
    });

    this.displayOrder();
  },

  handleProfileFail: function(response) {
    if (response.status == 401) {
      this.switchTo('setup');
    } else {
      var error = JSON.parse(response.responseText);
      this.showError(error.errors);
    }
  },

  displayOrder: function() {
    var _self = this;

    if (! this.isZatEnabled()) {
      this.zafClient.get('requirement:shopify_order_id').then(function(data) {
        var fieldId = data['requirement:shopify_order_id'].requirement_id;
        var fieldName = 'ticket.customField:custom_field_' + fieldId;

        _self.zafClient.get(fieldName).then(function(customField) {
          if (!_.isEmpty(customField[fieldName])) {
            _self.ajax('getOrder', customField[fieldName]);
          } else {
            _self.ajax('getOrders', _self.customer.id);
          }
        });
      });
    } else {
      _self.ajax('getOrders', _self.customer.id);
    }
  },

  handleOrder: function(data) {
    this.$('section[data-orders]').html(
      this.renderTemplate('order/single', this.fmtOrder(data.order))
    );

    this.$('#order-' + data.order.id).addClass('in');

    this.resizeApp();
  },

  handleOrders: function(data) {
    // Format order data
    this.orders = _.map(data.orders, function(order) {
      return this.fmtOrder(order);
    }.bind(this));

    this.$('section[data-orders]').html(
      this.renderTemplate('order/list', {
        orders: this.orders.slice(0,3),
        ordersUri: this.storeUrl + this.resources.ORDER_PATH
      })
    );

    this.resizeApp();
  },

  handleOrdersFail: function(response) {
    var error = JSON.parse(response.responseText);
    this.showError(this.I18n.t('global.error.orders'), error.errors);
    return;
  },

  fmtOrder: function(order) {
    var newOrder = order;

    newOrder.uri = this.storeUrl + this.resources.ORDER_PATH + order.id;

    if (this.setting('items_purchased')) {    
      newOrder.items_purchased = _.map(order.line_items, function(line_item) {
        var item = [];
        item.title = line_item.title;

        if (this.setting('item_price')) { item.price = line_item.price; }
        if (this.setting('item_quantity')) { item.quantity = line_item.quantity; }

        return item;
      }.bind(this));
    }

    newOrder.order_status = "not_fulfilled";

    if (!_.isUndefined(order.fulfillment_status)) {
      if (order.fulfillment_status !== null) {
        newOrder.order_status = order.fulfillment_status;
      }
      newOrder.fulfillment_status = true;
    }

    if (order.note === "" || order.note === null) {
      newOrder.note = this.I18n.t('customer.no_notes');
    } else {
      newOrder.note = this.truncateTextToLimit(order.note);
    }

    if (order.created_at) {
      newOrder.created_at = this.localeDate(order.created_at);
    }

    let trackingNumbers = _.filter(order.fulfillments, function(fulfillment) {
      if(fulfillment.tracking_number != null) {
        return {
          tracking_number : fulfillment.tracking_number,
          tracking_url : fulfillment.tracking_url
        }
      }
    });

    newOrder.tracking_numbers = trackingNumbers;

    return newOrder;
  },
  
  truncateTextToLimit: function (text) {
    if (text.length > this.noteCharacterLimit) {
      return text.substr(0, this.noteCharacterLimit) + '...';
    }
    return text;
  },

  loadSprites: function() {
    var svg = require('zd-svg-icons/dist/index.svg');
    var $svg = $('<object id="mySVG" type="image/svg+xml"/>').css('display', 'none').append(svg);
    $('body').prepend($svg);
  },

  toggleOrders: function() {
    var show = 'show';
    var rotation = 180;

    if (this.ordersShown) {
      show = 'hide';
      rotation = 360;

      this.ordersShown = false;
    } else {
      this.ordersShown = true;
    }

    TweenMax.to("#orders-toggle", .5, {rotation: rotation});
    $('section[data-orders] .panel-collapse').collapse(show);
  }
}

export default BaseApp.extend(ShopifyApp);
