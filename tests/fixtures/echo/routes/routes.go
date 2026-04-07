package main

import "github.com/labstack/echo/v4"

func SetupRoutes(e *echo.Echo) {
	api := e.Group(
		"/api",
	)
	orders := api.Group(
		"/orders",
	)
	orders.Use(
		JWTMiddleware,
	)
	orders.POST(
		"/",
		createOrder,
	)
	orders.GET(
		"/:id",
		getOrder,
	)
	orders.PUT(
		"/:id",
		updateOrder,
	)
	orders.DELETE(
		"/:id",
		deleteOrder,
	)
}
