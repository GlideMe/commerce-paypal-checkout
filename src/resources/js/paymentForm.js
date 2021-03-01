function findClosestParent (startElement, fn) {
    var parent = startElement.parentElement;
    if (!parent) return undefined;
    return fn(parent) ? parent : findClosestParent(parent, fn);
}

function initPaypalCheckout() {
    if (typeof paypal_checkout_sdk === "undefined") {
        setTimeout(initPaypalCheckout, 200);
    } else {
        var $wrapper = document.querySelector('.paypal-rest-form');
        var $form = findClosestParent($wrapper, function(element) {
            return element.tagName === 'FORM';
        });
        var paymentUrl = $wrapper.dataset.prepare;
        var completeUrl = $wrapper.dataset.complete;
        var transactionHash;
        var errorShown = false;
        var screenWidth = $(window).width();

        paypal_checkout_sdk.Buttons({
            style: {
                layout:  'horizontal',
                color:   'white',
                shape:   screenWidth > 767 ? 'pill' : 'rect',
                tagline: 'false',
                label:   'paypal',
                size: 'responsive'
            },

            // https://developer.paypal.com/docs/checkout/integration-features/shipping-callback)
            onShippingChange: function(data, actions) {
                // Reject non-US addresses
                if ((data.shipping_address.country_code !== 'US') && (data.shipping_address.country_code !== 'CA')) {
                    console.error("non-US/CA? rejecting!");
                    return actions.reject();
                }

                var csrfToken = $("[name=CRAFT_CSRF_TOKEN]").prop("value"),
                    path = "/" + window.location.pathname.split("/").filter(i => !!i).join("/"),
                    statesByAbbr = {"AB":"9","BC":"10","MB":"11","NB":"12","NL":"13","NT":"14","NS":"15","NU":"16","ON":"17","PE":"18","QC":"19","SK":"20","YT":"21","AL":"22","AK":"23","AZ":"24","AR":"25","CA":"26","CO":"27","CT":"28","DE":"29","DC":"30","FL":"31","GA":"32","HI":"33","ID":"34","IL":"35","IN":"36","IA":"37","KS":"38","KY":"39","LA":"40","ME":"41","MD":"42","MA":"43","MI":"44","MN":"45","MS":"46","MO":"47","MT":"48","NE":"49","NV":"50","NH":"51","NJ":"52","NM":"53","NY":"54","NC":"55","ND":"56","OH":"57","OK":"58","OR":"59","PA":"60","RI":"61","SC":"62","SD":"63","TN":"64","TX":"65","UT":"66","VT":"67","VA":"68","WA":"69","WV":"70","WI":"71","WY":"72"},
                    countryByAbbr = {"US":"233","CA":"38"};

                return $.ajax({
                    type: 'POST',
                    url: path,
                    data: {
                        action: 'commerce/cart/update-cart',
                        CRAFT_CSRF_TOKEN: csrfToken,
                        shippingAddress: {
                            city: data.shipping_address.city,
                            stateValue: statesByAbbr[data.shipping_address.state.toUpperCase()],
                            countryId: countryByAbbr[data.shipping_address.country_code.toUpperCase()],
                            zipCode: data.shipping_address.postal_code
                        }
                    },
                    dataType: 'json'
                }).then(function(response) {

                    if (response.error) {
                        console.error('error! ' + response.error + ' (' + JSON.stringify(response.errors) + ')');
                        return actions.reject();
                    }

                    let amount = {
                            currency_code: response.cart.paymentCurrency,
                            value: parseFloat(response.cart.totalPrice).toFixed(2),
                            breakdown: {
                                item_total: {
                                    currency_code: response.cart.paymentCurrency,
                                    value: parseFloat(response.cart.itemSubtotal).toFixed(2)
                                },
                                shipping: {
                                    currency_code: response.cart.paymentCurrency,
                                    value: parseFloat(response.cart.totalShippingCost).toFixed(2)
                                },
                                tax_total: {
                                    currency_code: response.cart.paymentCurrency,
                                    value: parseFloat(response.cart.totalTax).toFixed(2)
                                }
                            }
                        };

                    if (response.cart.totalDiscount !== 0) {
                        amount.breakdown.discount = {
                            currency_code: response.cart.paymentCurrency,
                            value: parseFloat(response.cart.totalDiscount * -1).toFixed(2)
                        };
                    }

                    // Patch the shipping amount
                    return actions.order.patch([
                        {
                            op: 'replace',
                            path: '/purchase_units/@reference_id==\'default\'/amount',
                            value: amount
                        }
                    ]);
                }).catch(function(error) {
                    console.error('error updating cart! ' + JSON.stringify(error));
                    return actions.reject();
                });
            },

            onClick: function(data, actions) {
                gtag('event', 'PayPal Checkout', {
                    'event_category' : 'Commerce',
                    'event_label' : 'Wristcam'
                });
                var csrfToken = $("[name=CRAFT_CSRF_TOKEN]").prop("value");
                    path = "/" + window.location.pathname.split("/").filter(i => !!i).join("/");

                $("#paypal-card-errors").addClass("hidden");

                // Get cart from server (can't use client-side, to avoid adding multiple times)
                return $.ajax({
                    type: 'GET',
                    url: path,
                    data: {
                        action: 'commerce/cart/get-cart'
                    },
                    dataType: 'json'
                }).then(function(response) {
                    if (response && response.cart && response.cart.lineItems) {
                        let product = $($form).closest(".paypal-button-container").attr("product"),
                            deviceColor = $("input[type=radio][name=" + product + "-device-color]:checked").prop("value"),
                            deviceSize  = $("input[type=radio][name=" + product + "-device-size]:checked").prop("value"),
                            purchasable = $("input[name=" + product + "-varients][deviceColor=" + deviceColor + "][deviceSize=" + deviceSize + "]"),
                            purchasableId = purchasable.attr("purchasableId");

                        function updateCartSingleItem() {
                            let reqParams = {
                                type: 'POST',
                                url: path,
                                data: {
                                    action: 'commerce/cart/update-cart',
                                    purchasableId: purchasableId,
                                    qty: 1,
                                    CRAFT_CSRF_TOKEN: csrfToken
                                },
                                dataType: 'json'
                            };
                            // If we got here and there's already an item - we need to remove it first
                            if (response.cart.lineItems.length === 1) {
                                reqParams.data["lineItems[" + response.cart.lineItems[0].id + "][remove]"] = 1;
                            }
                            return $.ajax(reqParams).then(function(response) {
                                // Cart updated!
                                return actions.resolve();
                            }).catch(function(error) {
                                // Failed updating cart
                                console.error('error updating cart! ' + JSON.stringify(error));
                                $("#paypal-card-errors").removeClass("hidden");
                                $("#paypal-card-errors").text("Error updating cart (" + error.statusText + " " + error.status + ")");
                                return actions.reject();
                            });
                        }

                        // Logic
                        // If no line items, add selected item to cart
                        // If single line item, qty 1 and different than button, replace it
                        // If single line item, qty 1 and same as button, no need to update
                        // otherwise, go to cart page
                        if (response.cart.lineItems.length === 0) {
                            // set selected item to cart
                            return updateCartSingleItem();
                        } else if (response.cart.lineItems.length === 1 && response.cart.lineItems[0].qty === 1) {
                            if (response.cart.lineItems[0].purchasableId === purchasableId) {
                                // Cart has selected item already, we can proceed
                                return actions.resolve();
                            } else {
                                // Replace single item in cart with the different item chosen in the UI
                                return updateCartSingleItem();
                            }
                        } else {
                            window.location = "/cart";
                            return actions.reject();
                        }
                    } else {
                        // Error getting cart?!
                        console.error('error getting cart! ' + JSON.stringify(response));
                        $("#paypal-card-errors").removeClass("hidden");
                        $("#paypal-card-errors").text("Failed to get cart (" + response + ")");
                        return actions.reject();
                    }
                }).catch(function(error) {
                    // Error getting cart?!
                    console.error('error getting cart! ' + JSON.stringify(error));
                    $("#paypal-card-errors").removeClass("hidden");
                    $("#paypal-card-errors").text("Failed to get cart (" + error.statusText + " " + error.status + ")");
                    return actions.reject();
                });
            },

            createOrder: function(data, actions) {
                var form = new FormData($form);

                return fetch(paymentUrl, {
                    method: 'post',
                    body: form,
                    headers: {
                        'Accept': 'application/json'
                    }
                }).then(function(res) {
                    return res.json();
                }).then(function(data) {
                    if (data.error) {
                        throw Error(data.error);
                    }
                    transactionHash = data.transactionHash;
                    return data.transactionId; // Use the same key name for order ID on the client and server
                }).catch(function(error) {
                    errorShown = true;
                    alert(error);
                });
            },
            onError: function(err) {
                $form.dataset.processing = false;
                if (!errorShown) {
                    alert(err);
                }
            },
            onApprove: function(data, actions) {
                var separator = '?';
                if (completeUrl.indexOf('?') >= 0) {
                    separator = '&';
                }
                $.ajax({
                    type: 'GET',
                    url: completeUrl + separator + 'commerceTransactionHash=' + transactionHash,
                    beforeSend: function() {
                        $(".pending-payment-modal-overlay").show();
                    },
                    complete: function() {
                        $(".pending-payment-modal-overlay").hide();
                    },
                    success: function(data) {
                        // Note: we don't actually expect to get here, we should get 302 upon success. Added here just to be on the safe side.
                        window.location = completeUrl + separator + 'commerceTransactionHash=' + transactionHash;
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        if (jqXHR.status === 302) {
                            window.location = jqXHR.getResponseHeader('x-redirect');
                            return;
                        }

                        $("#paypal-card-errors").removeClass("hidden");
                        $("#paypal-card-errors").html("Payment failed!</BR>Please try again or contact our <a href='mailto:support@wristcam.com' target='_blank'>Support</a>");

                        // Show alert after the page updates with the error html
                        setTimeout(function(){
                            alert("Payment failed! Please try again or contact our support.");
                        }, 200);
                    }
                });

            }
        }).render('#paypal-button-container');
    }
}

initPaypalCheckout();