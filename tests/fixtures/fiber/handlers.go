package main

import (
	"strconv"

	request "example.com/fiberapp/types/request"

	"github.com/gofiber/fiber/v2"
)

type WidgetResponse struct {
	Name  string `json:"name"`
	Page  int    `json:"page"`
	Token string `json:"token"`
}

func listWidgets(c *fiber.Ctx) error {
	page := c.Query("page")
	pageInt, _ := strconv.Atoi(page)

	return c.
		Status(fiber.StatusOK).
		JSON(fiber.Map{
			"data": []WidgetResponse{{
				Name: "Widget",
				Page: pageInt,
			}},
		})
}

func createWidget(c *fiber.Ctx) error {
	var req request.CreateWidgetRequest
	if err := c.BodyParser(&req); err != nil {
		return c.
			Status(fiber.StatusBadRequest).
			JSON(fiber.Map{
				"error": err.Error(),
			})
	}
	token := c.Get("TTOKEN")

	return c.
		Status(fiber.StatusCreated).
		JSON(fiber.Map{
			"message": "widget created",
			"data": WidgetResponse{
				Name:  req.Name,
				Page:  req.Page,
				Token: token,
			},
		})
}

func getWidget(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"data": fiber.Map{"id": c.Params("id")}})
}

func deleteWidget(c *fiber.Ctx) error {
	return c.SendStatus(fiber.StatusNoContent)
}

func Protected() fiber.Handler {
	return nil
}
