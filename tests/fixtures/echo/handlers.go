package main

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

type CreateOrderRequest struct {
	Total      int    `json:"total" validate:"required,min=1"`
	CustomerID string `json:"customer_id" validate:"required"`
}

type OrderResponse struct {
	ID         int    `json:"id"`
	Total      int    `json:"total"`
	CustomerID string `json:"customer_id"`
	Token      string `json:"token"`
}

func createOrder(c echo.Context) error {
	req := new(CreateOrderRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	token := c.Request().Header.Get("TTOKEN")
	return c.JSON(http.StatusCreated, OrderResponse{
		ID:         1,
		Total:      req.Total,
		CustomerID: req.CustomerID,
		Token:      token,
	})
}

func getOrder(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"data": OrderResponse{
			ID: 1,
		},
	})
}

func updateOrder(c echo.Context) error {
	req := new(CreateOrderRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusUnprocessableEntity, map[string]any{"errors": map[string]string{"customer_id": "required"}})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "updated"})
}

func deleteOrder(c echo.Context) error {
	return c.NoContent(http.StatusNoContent)
}

func JWTMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return next
}
